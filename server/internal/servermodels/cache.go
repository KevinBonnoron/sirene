package servermodels

import (
	"context"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/KevinBonnoron/sirene/server/internal/catalog"
	"github.com/KevinBonnoron/sirene/server/internal/inference"
	"github.com/KevinBonnoron/sirene/server/internal/infsrv"
)

const cacheTTL = time.Minute

type entry struct {
	installed   map[string]struct{}
	custom      []catalog.Model
	fetchedAt   time.Time
	fingerprint string
}

// Cache remembers what each inference server has installed. Entries expire
// after a minute and are dropped explicitly after pulls, deletes and edits.
type Cache struct {
	app     core.App
	servers *infsrv.Service
	mu      sync.Mutex
	entries map[string]*entry
}

func New(app core.App, servers *infsrv.Service) *Cache {
	return &Cache{app: app, servers: servers, entries: map[string]*entry{}}
}

func (c *Cache) Invalidate(serverID string) {
	c.mu.Lock()
	delete(c.entries, serverID)
	c.mu.Unlock()
}

func (c *Cache) InvalidateAll() {
	c.mu.Lock()
	c.entries = map[string]*entry{}
	c.mu.Unlock()
}

func healthStatus(rec *core.Record) string {
	var h struct {
		Status string `json:"status"`
	}
	_ = rec.UnmarshalJSONField("lastHealth", &h)
	return h.Status
}

// InstalledByServer only considers enabled servers that are not known to be
// offline; a single failing worker is logged and skipped.
func (c *Cache) InstalledByServer(ctx context.Context) (map[string]map[string]struct{}, error) {
	entries, err := c.collect(ctx)
	if err != nil {
		return nil, err
	}
	out := make(map[string]map[string]struct{}, len(entries))
	for id, e := range entries {
		out[id] = e.installed
	}
	return out, nil
}

func (c *Cache) ServersWithModel(ctx context.Context, modelID string) ([]string, error) {
	byServer, err := c.InstalledByServer(ctx)
	if err != nil {
		return nil, err
	}
	var out []string
	for id, installed := range byServer {
		if _, ok := installed[modelID]; ok {
			out = append(out, id)
		}
	}
	return out, nil
}

func (c *Cache) AggregatedCustom(ctx context.Context) ([]catalog.Model, error) {
	entries, err := c.collect(ctx)
	if err != nil {
		return nil, err
	}
	seen := map[string]struct{}{}
	out := []catalog.Model{}
	for _, e := range entries {
		for _, m := range e.custom {
			if _, dup := seen[m.ID]; dup {
				continue
			}
			seen[m.ID] = struct{}{}
			out = append(out, m)
		}
	}
	return out, nil
}

func (c *Cache) collect(ctx context.Context) (map[string]*entry, error) {
	servers, err := c.servers.ListEnabled()
	if err != nil {
		return nil, err
	}
	out := map[string]*entry{}
	var mu sync.Mutex
	var wg sync.WaitGroup
	for _, rec := range servers {
		if healthStatus(rec) == "offline" {
			continue
		}
		wg.Add(1)
		go func(rec *core.Record) {
			defer wg.Done()
			e, err := c.entryFor(ctx, rec)
			if err != nil {
				c.app.Logger().Warn("[server-models] failed to fetch models", "server", rec.GetString("name"), "url", rec.GetString("url"), "error", err)
				return
			}
			mu.Lock()
			out[rec.Id] = e
			mu.Unlock()
		}(rec)
	}
	wg.Wait()
	return out, nil
}

func (c *Cache) entryFor(ctx context.Context, rec *core.Record) (*entry, error) {
	target := infsrv.TargetOf(rec)
	fingerprint := target.URL + "|" + target.AuthToken
	c.mu.Lock()
	if e, ok := c.entries[rec.Id]; ok && e.fingerprint == fingerprint && time.Since(e.fetchedAt) < cacheTTL {
		c.mu.Unlock()
		return e, nil
	}
	c.mu.Unlock()

	list, err := inference.NewClient(target, c.app.Logger().Warn).ListModels(ctx)
	if err != nil {
		return nil, err
	}
	installed := make(map[string]struct{}, len(list.Installed))
	for _, id := range list.Installed {
		installed[id] = struct{}{}
	}
	custom := list.Custom
	if custom == nil {
		custom = []catalog.Model{}
	}
	e := &entry{installed: installed, custom: custom, fetchedAt: time.Now(), fingerprint: fingerprint}
	c.mu.Lock()
	c.entries[rec.Id] = e
	c.mu.Unlock()
	return e, nil
}
