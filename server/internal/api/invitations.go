package api

import (
	"net/http"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/KevinBonnoron/sirene/server/internal/auth"
)

func registerInvitationsPublic(g *router.RouterGroup[*core.RequestEvent], d *Deps) {
	g.GET("/invitations/{token}", func(e *core.RequestEvent) error {
		token, err := pathParam(e, "token")
		if err != nil {
			return err
		}
		invite, err := d.Invites.Resolve(token)
		if err != nil {
			return err
		}
		return e.JSON(http.StatusOK, invite)
	})
}

func registerInvitations(p *router.RouterGroup[*core.RequestEvent], d *Deps) {
	i := p.Group("/invitations")
	i.Bind(auth.RequireAdmin())

	i.GET("", func(e *core.RequestEvent) error {
		invites, err := d.Invites.ListPending()
		if err != nil {
			return err
		}
		return e.JSON(http.StatusOK, invites)
	})

	i.POST("", func(e *core.RequestEvent) error {
		var body struct {
			Email *string `json:"email"`
		}
		if err := bindJSON(e, &body); err != nil {
			return err
		}
		if err := requireString("email", body.Email, 1, 0); err != nil {
			return err
		}
		if err := checkEmail("email", *body.Email); err != nil {
			return err
		}
		created, err := d.Invites.Create(e.Auth.Id, *body.Email)
		if err != nil {
			return err
		}
		return e.JSON(http.StatusCreated, created)
	})

	i.DELETE("/{id}", func(e *core.RequestEvent) error {
		id, err := pathParam(e, "id")
		if err != nil {
			return err
		}
		if err := d.Invites.Revoke(id); err != nil {
			return err
		}
		return e.NoContent(http.StatusNoContent)
	})
}
