package api

import (
	"encoding/json"
	"net/http"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/KevinBonnoron/sirene/server/internal/auth"
)

func registerJobs(p *router.RouterGroup[*core.RequestEvent], d *Deps) {
	// The client parses the raw body (no code) here.
	p.DELETE("/jobs/{id}", func(e *core.RequestEvent) error {
		id, err := pathParam(e, "id")
		if err != nil {
			return err
		}
		if !d.Jobs.Dismiss(id) {
			return e.JSON(http.StatusConflict, map[string]string{"message": "Job not found or still running"})
		}
		return e.NoContent(http.StatusNoContent)
	}).Bind(auth.RequireScope("models:write"), auth.RequireAdmin())
}

func mustJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return "null"
	}
	return string(b)
}
