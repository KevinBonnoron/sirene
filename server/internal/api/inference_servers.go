package api

import (
	"context"
	"errors"
	"math"
	"net"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/KevinBonnoron/sirene/server/internal/apierr"
	"github.com/KevinBonnoron/sirene/server/internal/auth"
	"github.com/KevinBonnoron/sirene/server/internal/inference"
	"github.com/KevinBonnoron/sirene/server/internal/infsrv"
	"github.com/KevinBonnoron/sirene/server/internal/sse"
)

type inferenceServerBody struct {
	Name       *string  `json:"name"`
	URL        *string  `json:"url"`
	Enabled    *bool    `json:"enabled"`
	Priority   *float64 `json:"priority"`
	AuthToken  *string  `json:"authToken"`
	SyncPolicy *string  `json:"syncPolicy"`
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
		normalized, err := normalizeServerURL(*b.URL)
		if err != nil {
			return err
		}
		*b.URL = normalized
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
	if b.SyncPolicy != nil && !slices.Contains(infsrv.SyncPolicies, *b.SyncPolicy) {
		return apierr.Validation("syncPolicy: must be one of " + strings.Join(infsrv.SyncPolicies, ", "))
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
		rec, err := d.Servers.Create(infsrv.WriteInput{Name: *body.Name, URL: *body.URL, Enabled: *body.Enabled, Priority: int(*body.Priority), AuthToken: body.AuthToken, SyncPolicy: body.SyncPolicy})
		if err != nil {
			return err
		}
		if checked, err := d.Servers.CheckOne(e.Request.Context(), rec.Id); err == nil {
			rec = checked
		}
		d.Models.ReplicateTo(rec.Id)
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
		rec, err := d.Servers.Update(id, infsrv.UpdateInput{Name: body.Name, URL: body.URL, Enabled: body.Enabled, Priority: intPtr(body.Priority), AuthToken: body.AuthToken, SyncPolicy: body.SyncPolicy})
		if err == nil && body.SyncPolicy != nil && *body.SyncPolicy != "none" {
			d.Models.ReplicateTo(rec.Id)
		}
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

	w.POST("/registration-tokens", func(e *core.RequestEvent) error {
		token, expiresAt := d.Registry.Issue()
		return e.JSON(http.StatusCreated, map[string]any{"token": token, "expiresAt": expiresAt.UTC().Format(time.RFC3339)})
	})

	s.GET("/{id}/stats", func(e *core.RequestEvent) error {
		id, err := pathParam(e, "id")
		if err != nil {
			return err
		}
		rec, err := d.Servers.Get(id)
		if err != nil {
			return err
		}
		body, err := inference.NewClient(infsrv.TargetOf(rec), nil).Stats(e.Request.Context(), e.Request.URL.Query().Get("history") == "true")
		if errors.Is(err, inference.ErrStatsUnsupported) {
			return apierr.NotFound(apierr.CodeInferenceServerStatsUnsupported, "This inference server does not expose usage statistics")
		}
		if err != nil {
			return err
		}
		return e.Blob(http.StatusOK, "application/json", body)
	}).Bind(auth.RequireScope("inference-servers:read"))

	s.GET("/{id}/logs", func(e *core.RequestEvent) error {
		id, err := pathParam(e, "id")
		if err != nil {
			return err
		}
		rec, err := d.Servers.Get(id)
		if err != nil {
			return err
		}
		limit := 200
		if raw := e.Request.URL.Query().Get("limit"); raw != "" {
			v, err := strconv.Atoi(raw)
			if err != nil || v < 1 || v > 1000 {
				return apierr.Validation("limit: must be an integer between 1 and 1000")
			}
			limit = v
		}
		level := strings.ToUpper(e.Request.URL.Query().Get("level"))
		switch level {
		case "", "DEBUG", "INFO", "WARNING", "ERROR":
		default:
			return apierr.Validation("level: must be one of debug, info, warning, error")
		}
		body, err := inference.NewClient(infsrv.TargetOf(rec), nil).Logs(e.Request.Context(), limit, level)
		if errors.Is(err, inference.ErrStatsUnsupported) {
			return apierr.NotFound(apierr.CodeInferenceServerStatsUnsupported, "This inference server does not expose logs")
		}
		if err != nil {
			return err
		}
		return e.Blob(http.StatusOK, "application/json", body)
	}).Bind(auth.RequireScope("inference-servers:read"))

	s.GET("/{id}/events", func(e *core.RequestEvent) error {
		id, err := pathParam(e, "id")
		if err != nil {
			return err
		}
		rec, err := d.Servers.Get(id)
		if err != nil {
			return err
		}
		w := sse.Begin(e)
		err = inference.NewClient(infsrv.TargetOf(rec), nil).Events(e.Request.Context(), func(name, data string) error { return w.Event(name, data) })
		if errors.Is(err, inference.ErrStatsUnsupported) {
			_ = w.Event("unsupported", "{}")
		}
		return nil
	}).Bind(auth.RequireScope("inference-servers:read"), apis.SkipSuccessActivityLog())

	s.GET("/{id}/generations", func(e *core.RequestEvent) error {
		id, err := pathParam(e, "id")
		if err != nil {
			return err
		}
		if _, err := d.Servers.Get(id); err != nil {
			return err
		}
		limit := 50
		if v, err := strconv.Atoi(e.Request.URL.Query().Get("limit")); err == nil && v > 0 && v <= 200 {
			limit = v
		}
		records, err := e.App.FindRecordsByFilter("generations", "server = {:id}", "-created", limit, 0, map[string]any{"id": id})
		if err != nil {
			return err
		}
		names := map[string]string{}
		lookup := func(collection, recID string) string {
			if recID == "" {
				return ""
			}
			key := collection + ":" + recID
			if v, ok := names[key]; ok {
				return v
			}
			label := ""
			if r, err := e.App.FindRecordById(collection, recID); err == nil {
				label = r.GetString("name")
				if label == "" {
					label = r.GetString("email")
				}
			}
			names[key] = label
			return label
		}
		out := make([]map[string]any, 0, len(records))
		for _, g := range records {
			text := g.GetString("text")
			if len(text) > 240 {
				text = text[:240] + "…"
			}
			out = append(out, map[string]any{
				"id":       g.Id,
				"created":  g.GetDateTime("created").Time().UTC().Format(time.RFC3339),
				"text":     text,
				"duration": g.GetFloat("duration"),
				"model":    g.GetString("model"),
				"state":    g.GetString("state"),
				"user":     map[string]string{"id": g.GetString("user"), "name": lookup("users", g.GetString("user"))},
				"voice":    map[string]string{"id": g.GetString("voice"), "name": lookup("voices", g.GetString("voice"))},
			})
		}
		return e.JSON(http.StatusOK, out)
	}).Bind(auth.RequireScope("inference-servers:read"))

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

type registerServerBody struct {
	Name      string  `json:"name"`
	URL       string  `json:"url"`
	AuthToken *string `json:"authToken"`
}

func registerInferenceServersPublic(g *router.RouterGroup[*core.RequestEvent], d *Deps) {
	g.POST("/inference-servers/register", func(e *core.RequestEvent) error {
		token, ok := auth.Bearer(e)
		if !ok || !strings.HasPrefix(token, infsrv.RegistrationTokenPrefix) || !d.Registry.Valid(token) {
			return apierr.Unauthorized(apierr.CodeInferenceServerInvalidRegistrationToken, "Invalid or expired registration token")
		}
		var body registerServerBody
		if err := bindJSON(e, &body); err != nil {
			return err
		}
		body.Name = strings.TrimSpace(body.Name)
		if err := checkString("name", body.Name, 1, 100); err != nil {
			return err
		}
		normalized, err := normalizeServerURL(body.URL)
		if err != nil {
			return err
		}
		body.URL = normalized
		if body.AuthToken != nil && len(*body.AuthToken) > 200 {
			return apierr.Validation("authToken: too long")
		}
		rec, created, err := d.Servers.Upsert(infsrv.WriteInput{Name: body.Name, URL: body.URL, AuthToken: body.AuthToken})
		if err != nil {
			return err
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if checked, err := d.Servers.CheckOne(ctx, rec.Id); err == nil {
			rec = checked
		}
		d.Models.ReplicateTo(rec.Id)
		status := http.StatusOK
		if created {
			status = http.StatusCreated
		}
		return e.JSON(status, map[string]any{
			"id":         rec.Id,
			"name":       rec.GetString("name"),
			"url":        rec.GetString("url"),
			"created":    created,
			"lastHealth": rec.Get("lastHealth"),
		})
	})
}

// Hosting dashboards hand out bare domains.
func normalizeServerURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if err := checkString("url", raw, 1, 2048); err != nil {
		return "", err
	}
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return "", apierr.BadRequest(apierr.CodeInferenceServerInvalidURL, "url must be an absolute http(s) URL")
	}
	if isForbiddenHost(u.Hostname()) {
		return "", apierr.BadRequest(apierr.CodeInferenceServerInvalidURL, "url must not point at a link-local or cloud metadata address")
	}
	return strings.TrimSuffix(u.String(), "/"), nil
}

func isForbiddenHost(host string) bool {
	if strings.EqualFold(host, "metadata.google.internal") || strings.EqualFold(host, "metadata") {
		return true
	}
	ip := net.ParseIP(strings.Trim(host, "[]"))
	return ip != nil && inference.ForbiddenIP(ip)
}
