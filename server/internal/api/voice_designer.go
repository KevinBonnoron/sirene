package api

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/KevinBonnoron/sirene/server/internal/apierr"
	"github.com/KevinBonnoron/sirene/server/internal/auth"
	"github.com/KevinBonnoron/sirene/server/internal/inference"
	"github.com/KevinBonnoron/sirene/server/internal/infsrv"
)

func registerVoiceDesigner(p *router.RouterGroup[*core.RequestEvent], d *Deps) {
	vd := p.Group("/voice-designer")

	vd.POST("/preview", func(e *core.RequestEvent) error {
		var body struct {
			ModelID      *string `json:"modelId"`
			Text         *string `json:"text"`
			InstructText *string `json:"instructText"`
			Gender       *string `json:"gender"`
			Language     *string `json:"language"`
		}
		if err := bindJSON(e, &body); err != nil {
			return err
		}
		if err := requireString("modelId", body.ModelID, 1, 0); err != nil {
			return err
		}
		if err := requireString("text", body.Text, 1, 0); err != nil {
			return err
		}
		if err := requireString("instructText", body.InstructText, 1, 0); err != nil {
			return err
		}
		gender := "male"
		if body.Gender != nil {
			if *body.Gender != "male" && *body.Gender != "female" {
				return apierr.Validation("gender: must be male or female")
			}
			gender = *body.Gender
		}
		language := "en"
		if body.Language != nil && *body.Language != "" {
			language = *body.Language
		}
		ctx := e.Request.Context()
		model, err := d.Models.Find(ctx, auth.IdentityOf(e).UserID, *body.ModelID)
		if err != nil {
			return err
		}
		if model == nil {
			return apierr.NotFound(apierr.CodeModelNotFound, fmt.Sprintf("Model %q not found", *body.ModelID))
		}
		installed, err := d.Models.IsInstalled(ctx, *model)
		if err != nil {
			return err
		}
		if !installed {
			return apierr.BadRequest(apierr.CodeModelNotInstalled, fmt.Sprintf("Model %q is not installed", model.Name))
		}
		server, err := d.Router.Pick(ctx, model.ID)
		if err != nil {
			return err
		}
		release := d.Router.Acquire(server.Id)
		defer release()
		audio, err := inference.NewClient(infsrv.TargetOf(server), e.App.Logger().Warn).Generate(ctx, inference.Request{
			Backend:        model.Backend,
			Text:           *body.Text,
			ModelPath:      model.ID,
			InstructText:   body.InstructText,
			InstructGender: &gender,
			Language:       language,
		})
		if err != nil {
			return err
		}
		return e.Blob(http.StatusOK, "audio/wav", audio)
	}).Bind(auth.RequireScope("generate"))

	vd.POST("/save", func(e *core.RequestEvent) error {
		form, err := parseForm(e)
		if err != nil {
			return err
		}
		name, _ := form.Value("name")
		name = strings.TrimSpace(name)
		fh, hasAudio := form.File("audio")
		if name == "" || !hasAudio {
			return apierr.BadRequest(apierr.CodeVoiceDesignerNameAudioRequired, "name and audio are required")
		}
		text := map[string]string{}
		for _, key := range []string{"description", "language", "model", "transcript"} {
			if form.IsFile(key) {
				return apierr.BadRequest(apierr.CodeVoiceDesignerTextFieldsExpected, "description, language, model and transcript must be text fields")
			}
			text[key], _ = form.Value(key)
		}
		rec, err := d.Voices.SaveDesigned(auth.IdentityOf(e).UserID, name, text["description"], text["language"], text["model"], text["transcript"], fh)
		if err != nil {
			return err
		}
		return e.JSON(http.StatusCreated, rec)
	}).Bind(auth.RequireScope("voices:write"))
}
