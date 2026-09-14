package api

import (
	"net/http"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/KevinBonnoron/sirene/server/internal/auth"
)

func registerAPIKeys(p *router.RouterGroup[*core.RequestEvent], d *Deps) {
	k := p.Group("/api-keys")
	k.Bind(auth.RequireJWT())

	k.GET("", func(e *core.RequestEvent) error {
		keys, err := d.Keys.ListForUser(auth.IdentityOf(e).UserID)
		if err != nil {
			return err
		}
		return e.JSON(http.StatusOK, keys)
	})

	k.POST("", func(e *core.RequestEvent) error {
		var body struct {
			Name   *string   `json:"name"`
			Scopes *[]string `json:"scopes"`
		}
		if err := bindJSON(e, &body); err != nil {
			return err
		}
		if err := requireString("name", body.Name, 1, 120); err != nil {
			return err
		}
		created, err := d.Keys.Create(auth.IdentityOf(e).UserID, *body.Name, body.Scopes)
		if err != nil {
			return err
		}
		return e.JSON(http.StatusCreated, created)
	})

	k.DELETE("/{id}", func(e *core.RequestEvent) error {
		id, err := pathParam(e, "id")
		if err != nil {
			return err
		}
		if err := d.Keys.Revoke(auth.IdentityOf(e).UserID, id); err != nil {
			return err
		}
		return e.NoContent(http.StatusNoContent)
	})
}
