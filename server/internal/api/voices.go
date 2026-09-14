package api

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/KevinBonnoron/sirene/server/internal/apierr"
	"github.com/KevinBonnoron/sirene/server/internal/auth"
	"github.com/KevinBonnoron/sirene/server/internal/pbfiles"
)

func parseForm(e *core.RequestEvent) (*pbfiles.Form, error) {
	form, err := pbfiles.ParseForm(e.Request, multipartMemory)
	if err != nil {
		return nil, apierr.Validation("invalid form body")
	}
	return form, nil
}

func registerVoices(p *router.RouterGroup[*core.RequestEvent], d *Deps) {
	v := p.Group("/voices")
	read := auth.RequireScope("voices:read")
	write := auth.RequireScope("voices:write")

	v.POST("/import", func(e *core.RequestEvent) error {
		form, err := parseForm(e)
		if err != nil {
			return err
		}
		data, fh, err := form.FileBytes("file")
		if err != nil {
			return err
		}
		if fh == nil || !strings.HasSuffix(strings.ToLower(fh.Filename), ".zip") {
			return apierr.BadRequest(apierr.CodeVoiceZipRequired, "A .zip file is required")
		}
		rec, err := d.Voices.Import(auth.IdentityOf(e).UserID, data)
		if err != nil {
			return err
		}
		return e.JSON(http.StatusCreated, rec)
	}).Bind(write)

	v.GET("", func(e *core.RequestEvent) error {
		recs, err := d.Voices.List(auth.IdentityOf(e).UserID)
		if err != nil {
			return err
		}
		return e.JSON(http.StatusOK, recs)
	}).Bind(read)

	v.GET("/{id}", func(e *core.RequestEvent) error {
		id, err := pathParam(e, "id")
		if err != nil {
			return err
		}
		rec, err := d.Voices.Readable(id, auth.IdentityOf(e).UserID)
		if err != nil {
			return err
		}
		return e.JSON(http.StatusOK, rec)
	}).Bind(read)

	v.POST("", func(e *core.RequestEvent) error {
		form, err := parseForm(e)
		if err != nil {
			return err
		}
		rec, err := d.Voices.Create(auth.IdentityOf(e).UserID, form)
		if err != nil {
			return err
		}
		return e.JSON(http.StatusCreated, rec)
	}).Bind(write)

	v.PUT("/{id}", func(e *core.RequestEvent) error {
		id, err := pathParam(e, "id")
		if err != nil {
			return err
		}
		form, err := parseForm(e)
		if err != nil {
			return err
		}
		rec, err := d.Voices.Update(id, auth.IdentityOf(e).UserID, form)
		if err != nil {
			return err
		}
		return e.JSON(http.StatusOK, rec)
	}).Bind(write)

	v.GET("/{id}/export", func(e *core.RequestEvent) error {
		id, err := pathParam(e, "id")
		if err != nil {
			return err
		}
		out, err := d.Voices.Export(id, auth.IdentityOf(e).UserID)
		if err != nil {
			return err
		}
		h := e.Response.Header()
		h.Set("Content-Disposition", `attachment; filename="`+strings.NewReplacer(`"`, "_", "\r", "_", "\n", "_").Replace(out.Filename)+`"`)
		h.Set("Content-Length", strconv.Itoa(len(out.Data)))
		return e.Blob(http.StatusOK, "application/zip", out.Data)
	}).Bind(read)

	v.GET("/{id}/samples", func(e *core.RequestEvent) error {
		id, err := pathParam(e, "id")
		if err != nil {
			return err
		}
		recs, err := d.Voices.ListSamples(id, auth.IdentityOf(e).UserID)
		if err != nil {
			return err
		}
		return e.JSON(http.StatusOK, recs)
	}).Bind(read)

	v.POST("/{id}/samples", func(e *core.RequestEvent) error {
		id, err := pathParam(e, "id")
		if err != nil {
			return err
		}
		form, err := parseForm(e)
		if err != nil {
			return err
		}
		fh, ok := form.File("audio")
		if !ok {
			return apierr.BadRequest(apierr.CodeVoiceAudioRequired, "An audio file is required")
		}
		transcript, _ := form.Value("transcript")
		rec, err := d.Voices.AddSample(e.Request.Context(), id, auth.IdentityOf(e).UserID, fh, transcript)
		if err != nil {
			return err
		}
		return e.JSON(http.StatusCreated, rec)
	}).Bind(write)
}
