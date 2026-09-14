package models

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/KevinBonnoron/sirene/server/internal/apierr"
	"github.com/KevinBonnoron/sirene/server/internal/catalog"
	"github.com/KevinBonnoron/sirene/server/internal/inference"
	"github.com/KevinBonnoron/sirene/server/internal/infsrv"
	"github.com/KevinBonnoron/sirene/server/internal/jobs"
	"github.com/KevinBonnoron/sirene/server/internal/providers"
	"github.com/KevinBonnoron/sirene/server/internal/routing"
	"github.com/KevinBonnoron/sirene/server/internal/servermodels"
	"github.com/KevinBonnoron/sirene/server/internal/settings"
)

const hfBase = "https://huggingface.co"

var apiKeySetting = map[string]string{
	"elevenlabs": "elevenlabs_api_key",
	"openai":     "openai_api_key",
}

// Installation mirrors shared Model: derived from worker inventories plus
// in-flight pull jobs.
type Installation struct {
	ID        string   `json:"id"`
	Status    string   `json:"status"`
	Progress  int      `json:"progress"`
	Error     string   `json:"error,omitempty"`
	ServerIDs []string `json:"serverIds"`
}

type Service struct {
	app      core.App
	servers  *infsrv.Service
	cache    *servermodels.Cache
	router   *routing.Router
	jobs     *jobs.Store
	settings *settings.Service
	Changes  *Broadcaster
	wg       sync.WaitGroup
}

func New(app core.App, servers *infsrv.Service, cache *servermodels.Cache, router *routing.Router, store *jobs.Store, st *settings.Service) *Service {
	return &Service{app: app, servers: servers, cache: cache, router: router, jobs: store, settings: st, Changes: NewBroadcaster()}
}

// Wait blocks until background pulls and imports finish, at most timeout.
func (s *Service) Wait(timeout time.Duration) {
	done := make(chan struct{})
	go func() {
		s.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(timeout):
	}
}

func (s *Service) client(rec *core.Record) *inference.Client {
	return inference.NewClient(infsrv.TargetOf(rec), s.app.Logger().Warn)
}

func (s *Service) ScanCustom(ctx context.Context) ([]catalog.Model, error) {
	custom, err := s.cache.AggregatedCustom(ctx)
	if err != nil {
		return nil, err
	}
	out := []catalog.Model{}
	for _, m := range custom {
		if !catalog.IsCatalogID(m.ID) {
			out = append(out, m)
		}
	}
	return out, nil
}

// FullCatalog merges the static manifest with custom models scanned from the
// workers, hiding API-backed models whose key the user has not configured.
func (s *Service) FullCatalog(ctx context.Context, userID string) ([]catalog.Model, error) {
	custom, err := s.ScanCustom(ctx)
	if err != nil {
		return nil, err
	}
	all := append(slices.Clone(catalog.Models), custom...)
	out := make([]catalog.Model, 0, len(all))
	for _, m := range all {
		if m.HasType("api") {
			if key, ok := apiKeySetting[m.Backend]; ok {
				v, err := s.settings.Get(key, userID)
				if err != nil {
					return nil, err
				}
				if v == "" {
					continue
				}
			}
		}
		out = append(out, m)
	}
	return out, nil
}

func (s *Service) Find(ctx context.Context, userID, modelID string) (*catalog.Model, error) {
	all, err := s.FullCatalog(ctx, userID)
	if err != nil {
		return nil, err
	}
	for i := range all {
		if all[i].ID == modelID {
			return &all[i], nil
		}
	}
	return nil, nil
}

func (s *Service) Installations(ctx context.Context, models []catalog.Model) ([]Installation, error) {
	byServer, err := s.cache.InstalledByServer(ctx)
	if err != nil {
		return nil, err
	}
	running := s.jobs.List()
	out := []Installation{}
	for _, m := range models {
		serverIDs := []string{}
		for id, installed := range byServer {
			if _, ok := installed[m.ID]; ok {
				serverIDs = append(serverIDs, id)
			}
		}
		slices.Sort(serverIDs)
		var pulling []jobs.Job
		for _, j := range running {
			if j.Type == jobs.ModelPull && j.Status == jobs.Running && strings.HasPrefix(j.Target, m.ID+"::") {
				pulling = append(pulling, j)
			}
		}
		if len(pulling) > 0 {
			sum := 0
			for _, j := range pulling {
				sum += j.Progress
			}
			out = append(out, Installation{ID: m.ID, Status: "pulling", Progress: sum / len(pulling), ServerIDs: serverIDs})
			continue
		}
		if m.HasType("api") || len(serverIDs) > 0 {
			out = append(out, Installation{ID: m.ID, Status: "installed", Progress: 100, ServerIDs: serverIDs})
		}
	}
	return out, nil
}

func (s *Service) IsInstalled(ctx context.Context, m catalog.Model) (bool, error) {
	if m.HasType("api") {
		return true, nil
	}
	ids, err := s.cache.ServersWithModel(ctx, m.ID)
	return len(ids) > 0, err
}

func jobTarget(modelID, serverID string) string {
	return modelID + "::" + serverID
}

// resolveTargets picks the servers a pull/import should fan out to: every
// eligible server unless the caller named some, minus those that already
// have the model.
func (s *Service) resolveTargets(ctx context.Context, modelID string, serverIDs *[]string, verb string) ([]*core.Record, error) {
	all, err := s.servers.ListEnabled()
	if err != nil {
		return nil, err
	}
	var online []*core.Record
	for _, rec := range all {
		if st := routing.StatusOf(rec); st == "online" || st == "" || st == "unknown" {
			online = append(online, rec)
		}
	}
	if len(online) == 0 {
		return nil, apierr.Unavailable(apierr.CodeModelNoOnlineServer, fmt.Sprintf("No online inference server available to %s this model.", verb))
	}
	requested := online
	if serverIDs != nil {
		unique := slices.Compact(slices.Sorted(slices.Values(*serverIDs)))
		requested = nil
		var missing []string
		for _, id := range unique {
			idx := slices.IndexFunc(online, func(r *core.Record) bool { return r.Id == id })
			if idx < 0 {
				missing = append(missing, id)
				continue
			}
			requested = append(requested, online[idx])
		}
		if len(missing) > 0 {
			return nil, apierr.BadRequest(apierr.CodeModelInvalidServerSelection, "Servers not online or not found: "+strings.Join(missing, ", "))
		}
	}
	byServer, err := s.cache.InstalledByServer(ctx)
	if err != nil {
		return nil, err
	}
	var targets []*core.Record
	for _, rec := range requested {
		if _, has := byServer[rec.Id][modelID]; !has {
			targets = append(targets, rec)
		}
	}
	if len(targets) == 0 {
		return nil, apierr.Conflict(apierr.CodeModelAlreadyInstalled, "Model is already installed on every selected server.")
	}
	return targets, nil
}

func (s *Service) StartDownload(ctx context.Context, userID string, m catalog.Model, serverIDs *[]string) (jobIDs []string, alreadyRunning bool, err error) {
	targets, err := s.resolveTargets(ctx, m.ID, serverIDs, "pull")
	if err != nil {
		return nil, false, err
	}
	hfToken, err := s.settings.Get("hf_token", userID)
	if err != nil {
		return nil, false, err
	}
	jobIDs = []string{}
	for _, rec := range targets {
		target := jobTarget(m.ID, rec.Id)
		if existing, ok := s.jobs.FindRunning(jobs.ModelPull, target); ok {
			jobIDs = append(jobIDs, existing.ID)
			alreadyRunning = true
			continue
		}
		id := jobs.NewID()
		s.jobs.Start(id, jobs.ModelPull, m.Name+" → "+rec.GetString("name"), target)
		s.wg.Add(1)
		go func(rec *core.Record) {
			defer s.wg.Done()
			s.runDownload(id, m, rec, hfToken)
		}(rec)
		jobIDs = append(jobIDs, id)
	}
	return jobIDs, alreadyRunning, nil
}

func (s *Service) runDownload(jobID string, m catalog.Model, rec *core.Record, hfToken string) {
	files := make([]inference.PullFile, 0, len(m.Files))
	for _, f := range m.Files {
		repo, remote := m.Repo, f.Path
		if f.Repo != "" {
			repo = f.Repo
		}
		if f.RemotePath != "" {
			remote = f.RemotePath
		}
		files = append(files, inference.PullFile{URL: hfBase + "/" + repo + "/resolve/main/" + remote, Path: f.Path})
	}
	req := inference.PullRequest{Backend: m.Backend, ModelID: m.ID, Files: files, TotalSize: m.Size}
	if hfToken != "" {
		req.HFToken = &hfToken
	}
	serverName := rec.GetString("name")
	err := s.client(rec).PullModel(context.Background(), req, func(ev inference.PullEvent) error {
		switch ev.Status {
		case "error":
			msg := ev.Message
			if msg == "" {
				msg = "Pull failed"
			}
			return fmt.Errorf("%s", msg)
		case "downloading", "installing_deps":
			progress := 0.0
			if ev.Progress != nil {
				progress = min(*ev.Progress, 99)
			}
			label := m.Name + " → " + serverName
			if ev.Status == "installing_deps" {
				label = "Installing " + m.BackendDisplayName + " deps → " + serverName
			}
			s.jobs.Progress(jobID, progress, label)
		}
		return nil
	})
	if err != nil {
		s.jobs.Fail(jobID, err.Error())
	} else {
		s.jobs.Complete(jobID)
	}
	s.cache.Invalidate(rec.Id)
	s.Changes.Notify()
}

type Upload struct {
	Name        string
	ContentType string
	Data        []byte
}

var nonSlug = regexp.MustCompile(`[^a-z0-9_]`)

// ImportPiper validates an uploaded Piper bundle, derives the catalog slug
// from the espeak voice and sample rate, and fans the import out.
func (s *Service) ImportPiper(ctx context.Context, name string, onnx, config Upload, serverIDs *[]string) (slug string, jobIDs []string, err error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", nil, apierr.BadRequest(apierr.CodeModelPiperFieldsRequired, `Fields "onnx", "config", and "name" are required`)
	}
	var cfg map[string]any
	if err := json.Unmarshal(config.Data, &cfg); err != nil {
		return "", nil, apierr.BadRequest(apierr.CodeModelConfigInvalidJson, "Config file is not valid JSON")
	}
	espeak, _ := cfg["espeak"].(map[string]any)
	if cfg["espeak"] == nil || cfg["phoneme_id_map"] == nil {
		return "", nil, apierr.BadRequest(apierr.CodeModelConfigNotPiper, `Config must contain "espeak" and "phoneme_id_map" fields (Piper format)`)
	}
	voice, _ := espeak["voice"].(string)
	lang, region, _ := strings.Cut(voice, "-")
	locale := strings.ToLower(lang)
	if region != "" {
		locale = strings.ToLower(lang) + "_" + strings.ToUpper(region)
	}
	sampleRate := 22050.0
	if audio, ok := cfg["audio"].(map[string]any); ok {
		if sr, ok := audio["sample_rate"].(float64); ok {
			sampleRate = sr
		}
	}
	quality := "medium"
	if sampleRate <= 16000 {
		quality = "low"
	}
	speaker := nonSlug.ReplaceAllString(strings.ReplaceAll(strings.ToLower(name), " ", "_"), "")
	speaker = nonSlug.ReplaceAllString(regexp.MustCompile(`\s+`).ReplaceAllString(speaker, "_"), "")
	if speaker == "" {
		return "", nil, apierr.BadRequest(apierr.CodeModelInvalidName, "Invalid model name")
	}
	slug = "piper-" + locale + "-" + speaker + "-" + quality
	if catalog.IsCatalogID(slug) {
		return "", nil, apierr.Conflict(apierr.CodeModelNameConflict, fmt.Sprintf("Name %q conflicts with an existing catalog model", slug))
	}

	if onnx.Name == "" {
		onnx.Name = speaker + ".onnx"
	}
	if onnx.ContentType == "" {
		onnx.ContentType = "application/octet-stream"
	}
	if config.Name == "" {
		config.Name = speaker + ".onnx.json"
	}
	if config.ContentType == "" {
		config.ContentType = "application/json"
	}

	targets, err := s.resolveTargets(ctx, slug, serverIDs, "import")
	if err != nil {
		return "", nil, err
	}
	jobIDs = []string{}
	for _, rec := range targets {
		target := jobTarget(slug, rec.Id)
		if existing, ok := s.jobs.FindRunning(jobs.ModelImport, target); ok {
			jobIDs = append(jobIDs, existing.ID)
			continue
		}
		id := jobs.NewID()
		s.jobs.Start(id, jobs.ModelImport, "Importing "+name+" → "+rec.GetString("name"), target)
		s.wg.Add(1)
		go func(rec *core.Record) {
			defer s.wg.Done()
			s.runImport(id, rec, name, onnx, config)
		}(rec)
		jobIDs = append(jobIDs, id)
	}
	return slug, jobIDs, nil
}

func (s *Service) runImport(jobID string, rec *core.Record, name string, onnx, config Upload) {
	_, err := s.client(rec).ImportPiper(context.Background(), name,
		inference.FilePart{Name: onnx.Name, ContentType: onnx.ContentType, Data: onnx.Data},
		inference.FilePart{Name: config.Name, ContentType: config.ContentType, Data: config.Data})
	if err != nil {
		s.jobs.Fail(jobID, rec.GetString("name")+": "+err.Error())
	} else {
		s.jobs.Complete(jobID)
	}
	s.cache.Invalidate(rec.Id)
	s.Changes.Notify()
}

// Remove deletes the model from one server or from every server that has it.
func (s *Service) Remove(ctx context.Context, modelID, serverID string) error {
	byServer, err := s.cache.InstalledByServer(ctx)
	if err != nil {
		return err
	}
	all, err := s.servers.ListEnabled()
	if err != nil {
		return err
	}
	var targets []*core.Record
	for _, rec := range all {
		if _, has := byServer[rec.Id][modelID]; has && (serverID == "" || rec.Id == serverID) {
			targets = append(targets, rec)
		}
	}
	if serverID != "" && len(targets) == 0 {
		return apierr.NotFound(apierr.CodeModelNotInstalledOnServer, fmt.Sprintf("Model is not installed on server %q.", serverID))
	}
	var mu sync.Mutex
	var failures []string
	var wg sync.WaitGroup
	for _, rec := range targets {
		wg.Add(1)
		go func(rec *core.Record) {
			defer wg.Done()
			if err := s.client(rec).DeleteModel(ctx, modelID); err != nil {
				mu.Lock()
				failures = append(failures, rec.GetString("name")+": "+err.Error())
				mu.Unlock()
				return
			}
			s.cache.Invalidate(rec.Id)
		}(rec)
	}
	wg.Wait()
	s.Changes.Notify()
	if len(failures) > 0 {
		return apierr.Upstream(apierr.CodeModelDeleteFailed, fmt.Sprintf("Failed to delete on %d server(s): %s", len(failures), strings.Join(failures, "; ")))
	}
	return nil
}

func (s *Service) PresetVoices(ctx context.Context, modelID, userID string) ([]catalog.PresetVoice, error) {
	m, err := s.Find(ctx, userID, modelID)
	if err != nil {
		return nil, err
	}
	if m == nil {
		return nil, apierr.NotFound(apierr.CodeModelNotFound, "Model not found")
	}
	switch m.Backend {
	case "elevenlabs":
		key, err := s.RequireProviderKey(userID, "elevenlabs")
		if err != nil {
			return nil, err
		}
		return providers.ElevenLabsListVoices(ctx, key)
	case "openai":
		return providers.OpenAIVoices, nil
	}
	if m.PresetVoices == nil {
		return []catalog.PresetVoice{}, nil
	}
	return m.PresetVoices, nil
}

func (s *Service) RequireProviderKey(userID, backend string) (string, error) {
	key, err := s.settings.Get(apiKeySetting[backend], userID)
	if err != nil {
		return "", err
	}
	if key == "" {
		switch backend {
		case "elevenlabs":
			return "", apierr.BadRequest(apierr.CodeElevenLabsKeyNotConfigured, "ElevenLabs API key not configured. Go to Settings to add it.")
		default:
			return "", apierr.BadRequest(apierr.CodeOpenAIKeyNotConfigured, "OpenAI API key not configured. Go to Settings to add it.")
		}
	}
	return key, nil
}

// ExportCustom streams a custom model's zip from a server that has it.
func (s *Service) ExportCustom(ctx context.Context, modelID string) (*http.Response, context.CancelFunc, error) {
	custom, err := s.ScanCustom(ctx)
	if err != nil {
		return nil, nil, err
	}
	if !slices.ContainsFunc(custom, func(m catalog.Model) bool { return m.ID == modelID }) {
		return nil, nil, apierr.NotFound(apierr.CodeModelCustomNotFound, "Custom model not found")
	}
	rec, err := s.router.Pick(ctx, modelID)
	if err != nil {
		return nil, nil, err
	}
	res, cancel, err := s.client(rec).FetchExport(ctx, modelID)
	if err != nil {
		return nil, nil, err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		res.Body.Close()
		cancel()
		return nil, nil, apierr.Upstream(apierr.CodeModelExportFailed, "Export failed")
	}
	return res, cancel, nil
}
