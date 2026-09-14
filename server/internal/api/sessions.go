package api

import (
	"net/http"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/KevinBonnoron/sirene/server/internal/apierr"
	"github.com/KevinBonnoron/sirene/server/internal/auth"
)

func registerSessions(p *router.RouterGroup[*core.RequestEvent], d *Deps) {
	s := p.Group("/sessions")
	read := auth.RequireScope("sessions:read")
	write := auth.RequireScope("sessions:write")

	s.GET("", func(e *core.RequestEvent) error {
		recs, err := d.Sessions.List(auth.IdentityOf(e).UserID)
		if err != nil {
			return err
		}
		return e.JSON(http.StatusOK, recs)
	}).Bind(read)

	s.GET("/{id}", func(e *core.RequestEvent) error {
		id, err := pathParam(e, "id")
		if err != nil {
			return err
		}
		rec, err := d.Sessions.Owned(id, auth.IdentityOf(e).UserID)
		if err != nil {
			return err
		}
		return e.JSON(http.StatusOK, rec)
	}).Bind(read)

	s.POST("", func(e *core.RequestEvent) error {
		var body struct {
			Name        *string   `json:"name"`
			Generations *[]string `json:"generations"`
		}
		if err := bindJSON(e, &body); err != nil {
			return err
		}
		name := ""
		if body.Name != nil {
			if err := checkString("name", *body.Name, 0, 120); err != nil {
				return err
			}
			name = *body.Name
		}
		var gens []string
		if body.Generations != nil {
			gens = *body.Generations
		}
		rec, err := d.Sessions.Create(auth.IdentityOf(e).UserID, name, gens)
		if err != nil {
			return err
		}
		return e.JSON(http.StatusCreated, rec)
	}).Bind(write)

	s.PATCH("/{id}", func(e *core.RequestEvent) error {
		id, err := pathParam(e, "id")
		if err != nil {
			return err
		}
		raw := map[string]any{}
		if err := bindJSON(e, &raw); err != nil {
			return err
		}
		var name *string
		if v, present := raw["name"]; present {
			s, ok := v.(string)
			if v != nil && !ok {
				return apierr.Validation("name: must be a string")
			}
			if len(s) > 120 {
				return apierr.Validation("name: too long")
			}
			name = &s
		}
		var gens *[]string
		if v, present := raw["generations"]; present {
			list, ok := v.([]any)
			if !ok {
				return apierr.Validation("generations: must be an array")
			}
			ids := make([]string, 0, len(list))
			for _, item := range list {
				id, ok := item.(string)
				if !ok {
					return apierr.Validation("generations: entries must be strings")
				}
				ids = append(ids, id)
			}
			gens = &ids
		}
		rec, err := d.Sessions.Update(id, auth.IdentityOf(e).UserID, name, gens)
		if err != nil {
			return err
		}
		return e.JSON(http.StatusOK, rec)
	}).Bind(write)

	s.DELETE("/{id}", func(e *core.RequestEvent) error {
		id, err := pathParam(e, "id")
		if err != nil {
			return err
		}
		if err := d.Sessions.Delete(id, auth.IdentityOf(e).UserID); err != nil {
			return err
		}
		return e.NoContent(http.StatusNoContent)
	}).Bind(write)

	s.PATCH("/{id}/share", func(e *core.RequestEvent) error {
		id, err := pathParam(e, "id")
		if err != nil {
			return err
		}
		var body struct {
			Public *bool `json:"public"`
		}
		if err := bindJSON(e, &body); err != nil {
			return err
		}
		if body.Public == nil {
			return apierr.Validation("public: required")
		}
		rec, err := d.Sessions.SetPublic(id, auth.IdentityOf(e).UserID, *body.Public)
		if err != nil {
			return err
		}
		return e.JSON(http.StatusOK, rec)
	}).Bind(write)
}
