package api

import (
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/KevinBonnoron/sirene/server/internal/apierr"
	"github.com/KevinBonnoron/sirene/server/internal/auth"
	"github.com/KevinBonnoron/sirene/server/internal/models"
	"github.com/KevinBonnoron/sirene/server/internal/sse"
)

const multipartMemory = 32 << 20

// The public ping stream carries no data: clients re-fetch the protected
// inventory when it fires.
func registerModelsPublic(g *router.RouterGroup[*core.RequestEvent], d *Deps) {
	g.GET("/models/events", func(e *core.RequestEvent) error {
		w := sse.Begin(e)
		ch, unsubscribe := d.Models.Changes.Subscribe()
		defer unsubscribe()
		ctx := e.Request.Context()
		for {
			select {
			case <-ctx.Done():
				return nil
			case <-ch:
				if err := w.Event("change", "1"); err != nil {
					return nil
				}
			}
		}
	}).Bind(apis.SkipSuccessActivityLog())
}

func registerModels(p *router.RouterGroup[*core.RequestEvent], d *Deps) {
	m := p.Group("/models")
	read := auth.RequireScope("models:read")
	write := auth.RequireScope("models:write")

	m.GET("/catalog", func(e *core.RequestEvent) error {
		out, err := d.Models.FullCatalog(e.Request.Context(), auth.IdentityOf(e).UserID)
		if err != nil {
			return err
		}
		return e.JSON(http.StatusOK, out)
	}).Bind(read)

	m.GET("/installed", func(e *core.RequestEvent) error {
		ctx := e.Request.Context()
		all, err := d.Models.FullCatalog(ctx, auth.IdentityOf(e).UserID)
		if err != nil {
			return err
		}
		out, err := d.Models.Installations(ctx, all)
		if err != nil {
			return err
		}
		return e.JSON(http.StatusOK, out)
	}).Bind(read)

	m.GET("/{id}/voices", func(e *core.RequestEvent) error {
		id, err := pathParam(e, "id")
		if err != nil {
			return err
		}
		out, err := d.Models.PresetVoices(e.Request.Context(), id, auth.IdentityOf(e).UserID)
		if err != nil {
			return err
		}
		return e.JSON(http.StatusOK, out)
	}).Bind(read)

	m.DELETE("/{id}", func(e *core.RequestEvent) error {
		id, err := pathParam(e, "id")
		if err != nil {
			return err
		}
		if err := d.Models.Remove(e.Request.Context(), id, e.Request.URL.Query().Get("serverId")); err != nil {
			return err
		}
		return e.NoContent(http.StatusNoContent)
	}).Bind(write)

	m.POST("/{id}/pull", func(e *core.RequestEvent) error {
		id, err := pathParam(e, "id")
		if err != nil {
			return err
		}
		var body struct {
			ServerIDs *[]string `json:"serverIds"`
		}
		if err := bindJSON(e, &body); err != nil {
			return err
		}
		if body.ServerIDs != nil {
			for _, s := range *body.ServerIDs {
				if s == "" {
					return apierr.Validation("serverIds: entries must not be empty")
				}
			}
		}
		userID := auth.IdentityOf(e).UserID
		model, err := d.Models.Find(e.Request.Context(), userID, id)
		if err != nil {
			return err
		}
		if model == nil {
			return apierr.NotFound(apierr.CodeModelNotInCatalog, "Model \""+id+"\" not found in catalog")
		}
		jobIDs, alreadyRunning, err := d.Models.StartDownload(e.Request.Context(), userID, *model, body.ServerIDs)
		if err != nil {
			return err
		}
		status := http.StatusAccepted
		if alreadyRunning {
			status = http.StatusOK
		}
		return e.JSON(status, map[string][]string{"jobIds": jobIDs})
	}).Bind(write)

	m.POST("/piper/import", func(e *core.RequestEvent) error {
		if err := e.Request.ParseMultipartForm(multipartMemory); err != nil {
			return apierr.Validation("invalid multipart body")
		}
		onnx, err := readUpload(e, "onnx")
		if err != nil {
			return err
		}
		config, err := readUpload(e, "config")
		if err != nil {
			return err
		}
		names := e.Request.MultipartForm.Value["name"]
		if onnx == nil || config == nil || len(names) == 0 {
			return apierr.BadRequest(apierr.CodeModelPiperFieldsRequired, `Fields "onnx", "config", and "name" are required`)
		}
		var serverIDs *[]string
		if raw := e.Request.FormValue("serverIds"); raw != "" {
			var parsed []any
			if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
				return apierr.BadRequest(apierr.CodeModelServerIdsNotJson, "serverIds must be a JSON array of strings")
			}
			ids := make([]string, 0, len(parsed))
			for _, v := range parsed {
				s, ok := v.(string)
				if !ok || s == "" {
					return apierr.BadRequest(apierr.CodeModelServerIdsInvalid, "serverIds must be a JSON array of non-empty strings")
				}
				ids = append(ids, s)
			}
			serverIDs = &ids
		}
		slug, jobIDs, err := d.Models.ImportPiper(e.Request.Context(), names[0], *onnx, *config, serverIDs)
		if err != nil {
			return err
		}
		return e.JSON(http.StatusAccepted, map[string]any{"id": slug, "jobIds": jobIDs})
	}).Bind(write)

	m.GET("/{id}/export", func(e *core.RequestEvent) error {
		id, err := pathParam(e, "id")
		if err != nil {
			return err
		}
		res, cancel, err := d.Models.ExportCustom(e.Request.Context(), id)
		if err != nil {
			return err
		}
		defer cancel()
		defer res.Body.Close()
		h := e.Response.Header()
		h.Set("Content-Type", "application/zip")
		h.Set("Content-Disposition", `attachment; filename="piper-`+id+`.zip"`)
		if cl := res.Header.Get("Content-Length"); cl != "" {
			h.Set("Content-Length", cl)
		}
		_ = http.NewResponseController(e.Response).SetWriteDeadline(time.Time{})
		e.Response.WriteHeader(http.StatusOK)
		_, _ = io.Copy(e.Response, res.Body)
		return nil
	}).Bind(read)
}

// readUpload returns nil when the field is absent so callers can produce the
// domain-specific "fields required" error.
func readUpload(e *core.RequestEvent, field string) (*models.Upload, error) {
	files := e.Request.MultipartForm.File[field]
	if len(files) == 0 {
		return nil, nil
	}
	f, err := files[0].Open()
	if err != nil {
		return nil, err
	}
	defer f.Close()
	data, err := io.ReadAll(f)
	if err != nil {
		return nil, err
	}
	return &models.Upload{Name: files[0].Filename, ContentType: files[0].Header.Get("Content-Type"), Data: data}, nil
}
