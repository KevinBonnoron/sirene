package routing

import (
	"context"
	"fmt"
	"sort"
	"sync"

	"github.com/pocketbase/pocketbase/core"

	"github.com/KevinBonnoron/sirene/server/internal/apierr"
	"github.com/KevinBonnoron/sirene/server/internal/infsrv"
	"github.com/KevinBonnoron/sirene/server/internal/servermodels"
)

type Router struct {
	servers  *infsrv.Service
	cache    *servermodels.Cache
	mu       sync.Mutex
	inFlight map[string]int
}

func New(servers *infsrv.Service, cache *servermodels.Cache) *Router {
	return &Router{servers: servers, cache: cache, inFlight: map[string]int{}}
}

func noServer(msg string) error {
	return apierr.Unavailable(apierr.CodeModelNoOnlineServer, msg)
}

func StatusOf(rec *core.Record) string {
	var h struct {
		Status string `json:"status"`
	}
	_ = rec.UnmarshalJSONField("lastHealth", &h)
	return h.Status
}

func Eligible(all []*core.Record) []*core.Record {
	var online, unknown []*core.Record
	for _, rec := range all {
		switch StatusOf(rec) {
		case "online":
			online = append(online, rec)
		case "", "unknown":
			unknown = append(unknown, rec)
		}
	}
	if len(online) > 0 {
		return online
	}
	return unknown
}

func (r *Router) Pick(ctx context.Context, requireModel string) (*core.Record, error) {
	all, err := r.servers.ListEnabled()
	if err != nil {
		return nil, err
	}
	if len(all) == 0 {
		return nil, noServer("No inference server is configured. Add one from Settings.")
	}
	candidates := Eligible(all)
	if len(candidates) == 0 {
		return nil, noServer("All configured inference servers are offline.")
	}
	if requireModel != "" {
		ids, err := r.cache.ServersWithModel(ctx, requireModel)
		if err != nil {
			return nil, err
		}
		has := map[string]struct{}{}
		for _, id := range ids {
			has[id] = struct{}{}
		}
		var filtered []*core.Record
		for _, rec := range candidates {
			if _, ok := has[rec.Id]; ok {
				filtered = append(filtered, rec)
			}
		}
		if len(filtered) == 0 {
			return nil, noServer(fmt.Sprintf("Model %q is not installed on any online server.", requireModel))
		}
		candidates = filtered
	}
	r.mu.Lock()
	sort.SliceStable(candidates, func(i, k int) bool {
		li, lk := r.inFlight[candidates[i].Id], r.inFlight[candidates[k].Id]
		if li != lk {
			return li < lk
		}
		return candidates[i].GetInt("priority") > candidates[k].GetInt("priority")
	})
	r.mu.Unlock()
	return candidates[0], nil
}

func (r *Router) Acquire(serverID string) func() {
	r.mu.Lock()
	r.inFlight[serverID]++
	r.mu.Unlock()
	return func() {
		r.mu.Lock()
		if r.inFlight[serverID] > 0 {
			r.inFlight[serverID]--
		}
		r.mu.Unlock()
	}
}
