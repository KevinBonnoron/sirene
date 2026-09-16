package infsrv

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/KevinBonnoron/sirene/server/internal/apierr"
	"github.com/KevinBonnoron/sirene/server/internal/inference"
)

const (
	healthInterval = 15 * time.Second
	localName      = "Local"
)

type WriteInput struct {
	Name         string
	URL          string
	Enabled      bool
	Priority     int
	AuthToken    *string
	SyncPolicy   *string
	Registration string
}

type UpdateInput struct {
	Name         *string
	URL          *string
	Enabled      *bool
	Priority     *int
	AuthToken    *string
	SyncPolicy   *string
	Registration *string
}

const DefaultSyncPolicy = "all"

var SyncPolicies = []string{DefaultSyncPolicy, "cpu", "gpu", "none"}

type Service struct {
	app      core.App
	localURL string
	onChange func(serverID string)
	onOnline func(serverID string)

	mu     sync.Mutex
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

func New(app core.App, localURL string) *Service {
	return &Service{app: app, localURL: strings.TrimRight(localURL, "/"), onChange: func(string) {}, onOnline: func(string) {}}
}

func (s *Service) SetOnChange(fn func(serverID string)) {
	s.onChange = fn
}

// Runs when a probe finds a server online that was not; the models service uses it to catch the server up.
func (s *Service) SetOnOnline(fn func(serverID string)) {
	s.onOnline = fn
}

func TargetOf(rec *core.Record) inference.Target {
	return inference.Target{URL: rec.GetString("url"), AuthToken: rec.GetString("authToken")}
}

func (s *Service) List() ([]*core.Record, error) {
	return s.app.FindRecordsByFilter("inference_servers", "", "-priority", 0, 0)
}

func (s *Service) ListEnabled() ([]*core.Record, error) {
	return s.app.FindRecordsByFilter("inference_servers", "enabled = true", "-priority", 0, 0)
}

func (s *Service) Get(id string) (*core.Record, error) {
	rec, err := s.app.FindRecordById("inference_servers", id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, apierr.NotFound(apierr.CodeInferenceServerNotFound, "Inference server not found")
	}
	return rec, err
}

func (s *Service) Create(in WriteInput) (*core.Record, error) {
	col, err := s.app.FindCollectionByNameOrId("inference_servers")
	if err != nil {
		return nil, err
	}
	rec := core.NewRecord(col)
	rec.Set("name", in.Name)
	rec.Set("url", strings.TrimSuffix(in.URL, "/"))
	rec.Set("enabled", in.Enabled)
	rec.Set("priority", in.Priority)
	if in.AuthToken != nil {
		rec.Set("authToken", *in.AuthToken)
	}
	policy := DefaultSyncPolicy
	if in.SyncPolicy != nil {
		policy = *in.SyncPolicy
	}
	rec.Set("syncPolicy", policy)
	rec.Set("registration", in.Registration)
	rec.Set("lastHealth", unknownHealth())
	if err := s.app.Save(rec); err != nil {
		return nil, err
	}
	return rec, nil
}

func (s *Service) Update(id string, in UpdateInput) (*core.Record, error) {
	rec, err := s.Get(id)
	if err != nil {
		return nil, err
	}
	if in.Name != nil {
		rec.Set("name", *in.Name)
	}
	if in.URL != nil {
		if next := strings.TrimSuffix(*in.URL, "/"); next != rec.GetString("url") {
			rec.Set("url", next)
			rec.Set("lastHealth", unknownHealth())
		}
	}
	if in.Enabled != nil {
		rec.Set("enabled", *in.Enabled)
	}
	if in.Priority != nil {
		rec.Set("priority", *in.Priority)
	}
	if in.AuthToken != nil {
		rec.Set("authToken", *in.AuthToken)
	}
	if in.SyncPolicy != nil {
		rec.Set("syncPolicy", *in.SyncPolicy)
	}
	if in.Registration != nil {
		rec.Set("registration", *in.Registration)
	}
	if err := s.app.Save(rec); err != nil {
		return nil, err
	}
	s.onChange(id)
	return rec, nil
}

func (s *Service) Remove(id string) error {
	rec, err := s.Get(id)
	if err != nil {
		return err
	}
	if err := s.app.Delete(rec); err != nil {
		return err
	}
	s.onChange(id)
	return nil
}

func (s *Service) CheckOne(ctx context.Context, id string) (*core.Record, error) {
	rec, err := s.Get(id)
	if err != nil {
		return nil, err
	}
	if err := s.probeAndPersist(ctx, rec); err != nil {
		return nil, err
	}
	s.onChange(id)
	return rec, nil
}

// The desktop launcher picks a new port on every boot, so the Local URL is realigned; user-managed servers are left alone.
func (s *Service) Bootstrap() error {
	existing, err := s.app.FindFirstRecordByFilter("inference_servers", "name = {:name}", map[string]any{"name": localName})
	if err == nil {
		if existing.GetString("url") != s.localURL {
			existing.Set("url", s.localURL)
			existing.Set("lastHealth", unknownHealth())
			if err := s.app.Save(existing); err != nil {
				return err
			}
			s.app.Logger().Info("[inference-servers] realigned Local url", "url", s.localURL)
		}
		return nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	count, err := s.app.CountRecords("inference_servers")
	if err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	_, err = s.Create(WriteInput{Name: localName, URL: s.localURL, Enabled: true, Priority: 100})
	if err != nil {
		return err
	}
	s.app.Logger().Info("[inference-servers] seeded Local", "url", s.localURL)
	return nil
}

func (s *Service) StartHealthLoop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cancel != nil {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.cancel = cancel
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		s.runRound(ctx)
		ticker := time.NewTicker(healthInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.runRound(ctx)
			}
		}
	}()
}

func (s *Service) Stop() {
	s.mu.Lock()
	cancel := s.cancel
	s.cancel = nil
	s.mu.Unlock()
	if cancel != nil {
		cancel()
		s.wg.Wait()
	}
}

func (s *Service) runRound(ctx context.Context) {
	records, err := s.ListEnabled()
	if err != nil {
		s.app.Logger().Warn("[health] listing servers failed", "error", err)
		return
	}
	var wg sync.WaitGroup
	for _, rec := range records {
		wg.Add(1)
		go func(rec *core.Record) {
			defer wg.Done()
			if err := s.probeAndPersist(ctx, rec); err != nil {
				s.app.Logger().Warn("[health] probe failed", "server", rec.GetString("name"), "url", rec.GetString("url"), "error", err)
			}
		}(rec)
	}
	wg.Wait()
}

func (s *Service) probeAndPersist(ctx context.Context, rec *core.Record) error {
	status, message := "online", ""
	info, err := inference.Health(ctx, TargetOf(rec))
	if err != nil {
		status, message = "offline", err.Error()
		info = lastKnown(rec)
	}
	var prev struct {
		Status string `json:"status"`
	}
	_ = rec.UnmarshalJSONField("lastHealth", &prev)
	rec.Set("lastHealth", map[string]any{
		"at":     time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
		"status": status,
		"error":  message,
		"device": info.Device,
		"vram":   info.GPUMemory,
	})
	if err := s.app.Save(rec); err != nil {
		return err
	}
	if status == "online" && prev.Status != "online" && rec.GetBool("enabled") {
		s.onOnline(rec.Id)
	}
	return nil
}

// A failed probe must not forget what the worker runs on, or a CPU worker would accept GPU models until it comes back.
func lastKnown(rec *core.Record) inference.HealthInfo {
	var prev struct {
		Device string `json:"device"`
		VRAM   int64  `json:"vram"`
	}
	_ = rec.UnmarshalJSONField("lastHealth", &prev)
	return inference.HealthInfo{Device: prev.Device, GPUMemory: prev.VRAM}
}

func unknownHealth() map[string]any {
	return map[string]any{"at": "", "status": "unknown", "error": ""}
}
