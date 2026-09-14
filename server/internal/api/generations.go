package api

import (
	"net/http"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/KevinBonnoron/sirene/server/internal/auth"
)

func registerGenerations(p *router.RouterGroup[*core.RequestEvent], d *Deps) {
	g := p.Group("/generations")
	read := auth.RequireScope("generations:read")

	g.GET("", func(e *core.RequestEvent) error {
		q := e.Request.URL.Query()
		recs, err := d.Generation.List(auth.IdentityOf(e).UserID, q.Get("voice"), q.Get("model"))
		if err != nil {
			return err
		}
		return e.JSON(http.StatusOK, recs)
	}).Bind(read)

	g.GET("/{id}", func(e *core.RequestEvent) error {
		id, err := pathParam(e, "id")
		if err != nil {
			return err
		}
		rec, err := d.Generation.Owned(id, auth.IdentityOf(e).UserID)
		if err != nil {
			return err
		}
		return e.JSON(http.StatusOK, rec)
	}).Bind(read)

	g.GET("/{id}/align", func(e *core.RequestEvent) error {
		id, err := pathParam(e, "id")
		if err != nil {
			return err
		}
		out, err := d.Generation.Alignment(id, auth.IdentityOf(e).UserID)
		if err != nil {
			return err
		}
		return e.JSON(http.StatusOK, out)
	}).Bind(read)

	g.DELETE("/{id}", func(e *core.RequestEvent) error {
		id, err := pathParam(e, "id")
		if err != nil {
			return err
		}
		if err := d.Generation.Delete(id, auth.IdentityOf(e).UserID); err != nil {
			return err
		}
		return e.NoContent(http.StatusNoContent)
	}).Bind(auth.RequireScope("generations:write"))
}
