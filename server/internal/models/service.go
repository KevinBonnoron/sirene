package models

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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

// Mirrors the shared Model type.
type Installation struct {
	ID        string   `json:"id"`
	Status    string   `json:"status"`
	Progress  int      `json:"progress"`
	Error     string   `json:"error,omitempty"`
	ServerIDs []string `json:"serverIds"`
	Wanted    bool     `json:"wanted"`
}

type Service struct {
	app      core.App
	servers  *infsrv.Service
	cache    *servermodels.Cache
	router   *routing.Router
	jobs     *jobs.Store
	settings *settings.Service
	desired  *Desired
	Changes  *Broadcaster
	wg       sync.WaitGroup
}

func New(app core.App, servers *infsrv.Service, cache *servermodels.Cache, router *routing.Router, store *jobs.Store, st *settings.Service) *Service {
	return &Service{app: app, servers: servers, cache: cache, router: router, jobs: store, settings: st, desired: NewDesired(app), Changes: NewBroadcaster()}
}

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

func (s *Service) FullCatalog(ctx context.Context, userID string) ([]catalog.Model, error) {
	custom, err := s.ScanCustom(ctx)
	if err != nil {
		return nil, err
	}
	// A custom model is only described by the worker holding it, so a disabled server would
	// otherwise take the description with it and the model would vanish from the page
	// rather than read as wanted.
	seen := make(map[string]struct{}, len(custom))
	for _, m := range custom {
		seen[m.ID] = struct{}{}
	}
	remembered, err := s.desired.Custom()
	if err != nil {
		return nil, err
	}
	for _, m := range remembered {
		if _, ok := seen[m.ID]; !ok {
			custom = append(custom, m)
		}
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
	wanted, err := s.desired.List()
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
		_, isWanted := wanted[m.ID]
		if len(pulling) > 0 {
			sum := 0
			for _, j := range pulling {
				sum += j.Progress
			}
			out = append(out, Installation{ID: m.ID, Status: "pulling", Progress: sum / len(pulling), ServerIDs: serverIDs, Wanted: isWanted})
			continue
		}
		if m.HasType("api") || len(serverIDs) > 0 {
			out = append(out, Installation{ID: m.ID, Status: "installed", Progress: 100, ServerIDs: serverIDs, Wanted: isWanted})
			continue
		}
		// Asked for, and on no server that can be reached right now. Disabling a server is
		// not a decision to stop wanting the model it held.
		if isWanted {
			out = append(out, Installation{ID: m.ID, Status: "missing", Progress: 0, ServerIDs: serverIDs, Wanted: true})
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

// A blanket pull lands on every online server whose policy takes the model; an explicit selection is honoured as is.
func requirements(m catalog.Model) (hardware string, minVram int, backend string) {
	return m.Hardware, m.MinVram, m.Backend
}

// KnowsBackend is true when the worker lists the backend, or predates the list and can't be told apart.
func KnowsBackend(backends []string, backend string) bool {
	return len(backends) == 0 || backend == "" || slices.Contains(backends, backend)
}

func acceptingServers(online []*core.Record, m catalog.Model) []*core.Record {
	hardware, minVram, backend := requirements(m)
	var out []*core.Record
	for _, rec := range online {
		device, vram, backends := serverHealth(rec)
		if KnowsBackend(backends, backend) && Accepts(rec.GetString("syncPolicy"), hardware, minVram, device, vram) {
			out = append(out, rec)
		}
	}
	return out
}

func (s *Service) resolveTargets(ctx context.Context, m catalog.Model, serverIDs *[]string, verb string) ([]*core.Record, error) {
	modelID := m.ID
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
	if serverIDs == nil {
		if verb == "pull" {
			if requested = acceptingServers(online, m); len(requested) == 0 {
				return nil, apierr.Unavailable(apierr.CodeModelNoAcceptingServer, "No online inference server accepts this model: check its hardware, VRAM and each server's sync policy.")
			}
		}
	} else {
		unique := slices.Compact(slices.Sorted(slices.Values(*serverIDs)))
		requested = nil
		hardware, minVram, backend := requirements(m)
		var missing, unfit, unaware []string
		for _, id := range unique {
			idx := slices.IndexFunc(online, func(r *core.Record) bool { return r.Id == id })
			if idx < 0 {
				missing = append(missing, id)
				continue
			}
			// A hand-picked server skips the sync policy, never the hardware check.
			device, vram, backends := serverHealth(online[idx])
			if !KnowsBackend(backends, backend) {
				unaware = append(unaware, online[idx].GetString("name"))
				continue
			}
			if !Accepts("all", hardware, minVram, device, vram) {
				unfit = append(unfit, online[idx].GetString("name"))
				continue
			}
			requested = append(requested, online[idx])
		}
		if len(missing) > 0 {
			return nil, apierr.BadRequest(apierr.CodeModelInvalidServerSelection, "Servers not online or not found: "+strings.Join(missing, ", "))
		}
		if len(unaware) > 0 {
			return nil, apierr.BadRequest(apierr.CodeModelInvalidServerSelection, fmt.Sprintf("Servers whose worker predates the %s backend, update their image: %s", backend, strings.Join(unaware, ", ")))
		}
		if len(unfit) > 0 {
			return nil, apierr.BadRequest(apierr.CodeModelInvalidServerSelection, "Servers that can't run this model (hardware or VRAM): "+strings.Join(unfit, ", "))
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
	targets, err := s.resolveTargets(ctx, m, serverIDs, "pull")
	if err != nil {
		var ae *apierr.Error
		if errors.As(err, &ae) && ae.Code == apierr.CodeModelAlreadyInstalled {
			if derr := s.desired.Add(m); derr != nil {
				return nil, false, derr
			}
		}
		return nil, false, err
	}
	if err := s.desired.Add(m); err != nil {
		return nil, false, err
	}
	hfToken, err := s.settings.Get("hf_token", userID)
	if err != nil {
		return nil, false, err
	}
	jobIDs = []string{}
	for _, rec := range targets {
		target := jobTarget(m.ID, rec.Id)
		id := jobs.NewID()
		if existing, started := s.jobs.StartUnlessRunning(id, jobs.ModelPull, m.Name+" → "+rec.GetString("name"), target); !started {
			jobIDs = append(jobIDs, existing.ID)
			alreadyRunning = true
			continue
		}
		s.wg.Add(1)
		go func(rec *core.Record) {
			defer s.wg.Done()
			if m.Repo == "" {
				s.runCopy(id, m, rec)
			} else {
				s.runDownload(id, m, rec, hfToken)
			}
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

// A custom voice has no upstream repo: it is exported from a worker that has it and imported on the target as is.
func (s *Service) runCopy(jobID string, m catalog.Model, target *core.Record) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Hour)
	defer cancel()
	err := func() error {
		source, err := s.router.Pick(ctx, m.ID)
		if err != nil {
			return err
		}
		res, cancelExport, err := s.client(source).FetchExport(ctx, m.ID)
		if err != nil {
			return err
		}
		defer cancelExport()
		defer res.Body.Close()
		if res.StatusCode < 200 || res.StatusCode >= 300 {
			return fmt.Errorf("export from %s failed (HTTP %d)", source.GetString("name"), res.StatusCode)
		}
		s.jobs.Progress(jobID, 50, m.Name+" · "+source.GetString("name")+" → "+target.GetString("name"))
		return s.client(target).ImportArchive(ctx, m.ID, res.Body)
	}()
	if err != nil {
		s.jobs.Fail(jobID, err.Error())
	} else {
		s.jobs.Complete(jobID)
	}
	s.cache.Invalidate(target.Id)
	s.Changes.Notify()
}

type Upload struct {
	Name        string
	ContentType string
	Data        []byte
}

var nonSlug = regexp.MustCompile(`[^a-z0-9_]`)

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

	targets, err := s.resolveTargets(ctx, catalog.Model{ID: slug, Backend: "piper", Hardware: "cpu"}, serverIDs, "import")
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

func (s *Service) Remove(ctx context.Context, modelID, serverID string) error {
	if serverID == "" {
		if err := s.desired.Remove(modelID); err != nil {
			return err
		}
	}
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

// Accepts reports whether a server's sync policy, device and VRAM take a model; minVram is in GiB and only enforced when both sides are known.
func Accepts(policy, hardware string, minVram int, device string, vram int64) bool {
	if hardware == "" {
		hardware = "cpu"
	}
	if hardware == "gpu" && device == "cpu" {
		return false
	}
	if minVram > 0 && vram > 0 && int64(minVram)<<30 > vram {
		return false
	}
	switch policy {
	case "cpu", "gpu":
		return hardware == policy
	case "none":
		return false
	}
	return true
}

func serverHealth(rec *core.Record) (device string, vram int64, backends []string) {
	var health struct {
		Device   string   `json:"device"`
		VRAM     int64    `json:"vram"`
		Backends []string `json:"backends"`
	}
	_ = rec.UnmarshalJSONField("lastHealth", &health)
	return health.Device, health.VRAM, health.Backends
}

// ReplicateAll catches every online server up: a worker coming back brings models the others may lack.
func (s *Service) ReplicateAll() {
	servers, err := s.servers.ListEnabled()
	if err != nil {
		s.app.Logger().Warn("[replicate] listing servers failed", "error", err)
		return
	}
	for _, rec := range servers {
		if routing.StatusOf(rec) == "online" {
			s.ReplicateTo(rec.Id)
		}
	}
}

// ReplicateTo pulls onto one server every model the operator asked for, as far as its sync
// policy and hardware allow. Best effort: failures surface as job errors, never to the
// caller. What other servers happen to hold is an observation and does not decide this.
func (s *Service) ReplicateTo(serverID string) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		rec, err := s.servers.Get(serverID)
		if err != nil || !rec.GetBool("enabled") || routing.StatusOf(rec) != "online" {
			return
		}
		policy := rec.GetString("syncPolicy")
		device, vram, backends := serverHealth(rec)
		if policy == "none" {
			return
		}
		s.cache.Invalidate(serverID)
		byServer, err := s.cache.InstalledByServer(ctx)
		if err != nil {
			s.app.Logger().Warn("[replicate] listing installed models failed", "server", rec.GetString("name"), "error", err)
			return
		}
		wanted, err := s.desired.List()
		if err != nil {
			s.app.Logger().Warn("[replicate] listing wanted models failed", "server", rec.GetString("name"), "error", err)
			return
		}
		custom, err := s.ScanCustom(ctx)
		if err != nil {
			s.app.Logger().Warn("[replicate] listing custom models failed", "server", rec.GetString("name"), "error", err)
			return
		}
		for _, m := range append(slices.Clone(catalog.Models), custom...) {
			if _, ok := wanted[m.ID]; !ok || m.HasType("api") {
				continue
			}
			if _, has := byServer[serverID][m.ID]; has {
				continue
			}
			if !KnowsBackend(backends, m.Backend) || !Accepts(policy, m.Hardware, m.MinVram, device, vram) {
				continue
			}
			ids := []string{serverID}
			if _, _, err := s.StartDownload(ctx, "", m, &ids); err != nil {
				s.app.Logger().Warn("[replicate] pull not started", "server", rec.GetString("name"), "model", m.ID, "error", err)
			}
		}
	}()
}
