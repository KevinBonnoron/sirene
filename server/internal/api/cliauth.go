package api

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/KevinBonnoron/sirene/server/internal/apierr"
	"github.com/KevinBonnoron/sirene/server/internal/auth"
)

func registerCliAuthPublic(g *router.RouterGroup[*core.RequestEvent], d *Deps) {
	g.POST("/auth/cli/start", func(e *core.RequestEvent) error {
		var body struct {
			Origin *string   `json:"origin"`
			Scopes *[]string `json:"scopes"`
		}
		if err := bindJSON(e, &body); err != nil {
			return err
		}
		base := requestOrigin(e)
		if body.Origin != nil {
			u, err := url.Parse(*body.Origin)
			if err != nil || u.Scheme == "" || u.Host == "" {
				return apierr.Validation("origin: invalid url")
			}
			base = *body.Origin
		}
		out, err := d.CliAuth.Start(strings.TrimRight(base, "/")+"/cli-auth", body.Scopes)
		if err != nil {
			return err
		}
		return e.JSON(http.StatusOK, out)
	})

	g.POST("/auth/cli/poll", func(e *core.RequestEvent) error {
		var body struct {
			DeviceCode *string `json:"deviceCode"`
		}
		if err := bindJSON(e, &body); err != nil {
			return err
		}
		if err := requireString("deviceCode", body.DeviceCode, 1, 0); err != nil {
			return err
		}
		return e.JSON(http.StatusOK, d.CliAuth.Poll(*body.DeviceCode))
	})
}

func registerCliAuthProtected(p *router.RouterGroup[*core.RequestEvent], d *Deps) {
	c := p.Group("/auth/cli")
	c.Bind(auth.RequireJWT())

	c.GET("/lookup", func(e *core.RequestEvent) error {
		code := e.Request.URL.Query().Get("code")
		if code == "" {
			return apierr.Validation("code: required")
		}
		out, err := d.CliAuth.Lookup(code)
		if err != nil {
			return err
		}
		return e.JSON(http.StatusOK, out)
	})

	c.POST("/approve", func(e *core.RequestEvent) error {
		var body struct {
			Code   *string   `json:"code"`
			Name   *string   `json:"name"`
			Scopes *[]string `json:"scopes"`
		}
		if err := bindJSON(e, &body); err != nil {
			return err
		}
		if err := requireString("code", body.Code, 1, 0); err != nil {
			return err
		}
		if err := requireString("name", body.Name, 1, 120); err != nil {
			return err
		}
		if body.Scopes != nil {
			for _, s := range *body.Scopes {
				if !auth.IsKnownScope(s) {
					return apierr.Validation("scopes: unknown scope " + s)
				}
			}
		}
		if err := d.CliAuth.Approve(*body.Code, auth.IdentityOf(e).UserID, *body.Name, body.Scopes); err != nil {
			return err
		}
		return e.JSON(http.StatusOK, map[string]bool{"success": true})
	})
}

func requestOrigin(e *core.RequestEvent) string {
	scheme := "http"
	if e.IsTLS() || strings.EqualFold(e.Request.Header.Get("X-Forwarded-Proto"), "https") {
		scheme = "https"
	}
	host := e.Request.Header.Get("X-Forwarded-Host")
	if host == "" {
		host = e.Request.Host
	}
	return scheme + "://" + host
}
