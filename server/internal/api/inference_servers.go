package api

import (
	"math"
	"net/http"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/KevinBonnoron/sirene/server/internal/apierr"
	"github.com/KevinBonnoron/sirene/server/internal/auth"
	"github.com/KevinBonnoron/sirene/server/internal/infsrv"
)

type inferenceServerBody struct {
	Name      *string  `json:"name"`
	URL       *string  `json:"url"`
	Enabled   *bool    `json:"enabled"`
	Priority  *float64 `json:"priority"`
	AuthToken *string  `json:"authToken"`
}

func (b *inferenceServerBody) validate(partial bool) error {
	if b.Name != nil {
		*b.Name = strings.TrimSpace(*b.Name)
		if err := checkString("name", *b.Name, 1, 100); err != nil {
			return err
		}
	} else if !partial {
		return apierr.Validation("name: required")
	}
	if b.URL != nil {
		*b.URL = strings.TrimSpace(*b.URL)
		if err := checkString("url", *b.URL, 1, 2048); err != nil {
			return err
		}
	} else if !partial {
		return apierr.Validation("url: required")
	}
	if b.Enabled == nil && !partial {
		return apierr.Validation("enabled: required")
	}
	if b.Priority != nil {
		if *b.Priority != math.Trunc(*b.Priority) {
			return apierr.Validation("priority: must be an integer")
		}
	} else if !partial {
		return apierr.Validation("priority: required")
	}
	if b.AuthToken != nil && len(*b.AuthToken) > 200 {
		return apierr.Validation("authToken: too long")
	}
	return nil
}

func intPtr(f *float64) *int {
	if f == nil {
		return nil
	}
	v := int(*f)
	return &v
}

// The registry is admin-only; scopes layer on top so an admin can still mint
// a key that cannot touch it.
func registerInferenceServers(p *router.RouterGroup[*core.RequestEvent], d *Deps) {
	s := p.Group("/inference-servers")
	s.Bind(auth.RequireAdmin())

	s.GET("", func(e *core.RequestEvent) error {
		records, err := d.Servers.List()
		if err != nil {
			return err
		}
		if records == nil {
			records = []*core.Record{}
		}
		return e.JSON(http.StatusOK, records)
	}).Bind(auth.RequireScope("inference-servers:read"))

	w := s.Group("")
	w.Bind(auth.RequireScope("inference-servers:write"))

	w.POST("", func(e *core.RequestEvent) error {
		var body inferenceServerBody
		if err := bindJSON(e, &body); err != nil {
			return err
		}
		if err := body.validate(false); err != nil {
			return err
		}
		rec, err := d.Servers.Create(infsrv.WriteInput{Name: *body.Name, URL: *body.URL, Enabled: *body.Enabled, Priority: int(*body.Priority), AuthToken: body.AuthToken})
		if err != nil {
			return err
		}
		return e.JSON(http.StatusCreated, rec)
	})

	w.PATCH("/{id}", func(e *core.RequestEvent) error {
		id, err := pathParam(e, "id")
		if err != nil {
			return err
		}
		var body inferenceServerBody
		if err := bindJSON(e, &body); err != nil {
			return err
		}
		if err := body.validate(true); err != nil {
			return err
		}
		rec, err := d.Servers.Update(id, infsrv.UpdateInput{Name: body.Name, URL: body.URL, Enabled: body.Enabled, Priority: intPtr(body.Priority), AuthToken: body.AuthToken})
		if err != nil {
			return err
		}
		return e.JSON(http.StatusOK, rec)
	})

	w.DELETE("/{id}", func(e *core.RequestEvent) error {
		id, err := pathParam(e, "id")
		if err != nil {
			return err
		}
		if err := d.Servers.Remove(id); err != nil {
			return err
		}
		return e.NoContent(http.StatusNoContent)
	})

	w.POST("/{id}/test", func(e *core.RequestEvent) error {
		id, err := pathParam(e, "id")
		if err != nil {
			return err
		}
		rec, err := d.Servers.CheckOne(e.Request.Context(), id)
		if err != nil {
			return err
		}
		return e.JSON(http.StatusOK, rec)
	})
}
