package api

import (
	"encoding/json"
	"net/http"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/KevinBonnoron/sirene/server/internal/auth"
	"github.com/KevinBonnoron/sirene/server/internal/sse"
)

func registerJobs(p *router.RouterGroup[*core.RequestEvent], d *Deps) {
	p.GET("/jobs", func(e *core.RequestEvent) error {
		return e.JSON(http.StatusOK, d.Jobs.List())
	}).Bind(auth.RequireScope("models:read"))

	p.GET("/jobs/stream", func(e *core.RequestEvent) error {
		w := sse.Begin(e)
		sub, snapshot := d.Jobs.Subscribe()
		defer d.Jobs.Unsubscribe(sub)
		if err := w.Event("snapshot", mustJSON(snapshot)); err != nil {
			return nil
		}
		ctx := e.Request.Context()
		for {
			select {
			case <-ctx.Done():
				return nil
			case u, ok := <-sub.C:
				if !ok {
					return nil
				}
				var err error
				if u.Removed {
					err = w.Event("remove", mustJSON(map[string]string{"id": u.ID}))
				} else {
					err = w.Event("job", mustJSON(u.Job))
				}
				if err != nil {
					return nil
				}
			}
		}
	}).Bind(auth.RequireScope("models:read"), apis.SkipSuccessActivityLog())

	// Dismissing a running job is refused; the raw body (no code) is what the
	// client has always parsed here.
	p.DELETE("/jobs/{id}", func(e *core.RequestEvent) error {
		id, err := pathParam(e, "id")
		if err != nil {
			return err
		}
		if !d.Jobs.Dismiss(id) {
			return e.JSON(http.StatusConflict, map[string]string{"message": "Job not found or still running"})
		}
		return e.NoContent(http.StatusNoContent)
	}).Bind(auth.RequireScope("models:write"))
}

func mustJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return "null"
	}
	return string(b)
}
