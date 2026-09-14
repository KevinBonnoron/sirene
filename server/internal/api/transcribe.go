package api

import (
	"errors"
	"net/http"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/KevinBonnoron/sirene/server/internal/apierr"
	"github.com/KevinBonnoron/sirene/server/internal/auth"
	"github.com/KevinBonnoron/sirene/server/internal/inference"
	"github.com/KevinBonnoron/sirene/server/internal/infsrv"
)

func registerTranscribe(p *router.RouterGroup[*core.RequestEvent], d *Deps) {
	p.POST("/transcribe", func(e *core.RequestEvent) error {
		form, err := parseForm(e)
		if err != nil {
			return err
		}
		fh, ok := form.File("audio")
		if !ok {
			return apierr.BadRequest(apierr.CodeTranscribeAudioRequired, "audio file is required")
		}
		ctx := e.Request.Context()

		// Catalog order runs small to large; the first installed Whisper wins.
		all, err := d.Models.FullCatalog(ctx, auth.IdentityOf(e).UserID)
		if err != nil {
			return err
		}
		modelPath := ""
		for _, m := range all {
			if m.Backend != "whisper" {
				continue
			}
			installed, err := d.Models.IsInstalled(ctx, m)
			if err != nil {
				return err
			}
			if installed {
				modelPath = m.ID
				break
			}
		}
		if modelPath == "" {
			return apierr.BadRequest(apierr.CodeModelWhisperNotInstalled, "No Whisper model installed. Please install one from the Models page.")
		}
		server, err := d.Router.Pick(ctx, modelPath)
		if err != nil {
			return err
		}
		src, err := fh.Open()
		if err != nil {
			return err
		}
		defer src.Close()
		contentType := fh.Header.Get("Content-Type")
		if contentType == "" {
			contentType = "audio/wav"
		}
		release := d.Router.Acquire(server.Id)
		defer release()
		out, err := inference.NewClient(infsrv.TargetOf(server), e.App.Logger().Warn).Transcribe(ctx, src, fh.Filename, contentType, modelPath)
		if errors.Is(err, inference.ErrTranscribeTimeout) {
			return apierr.GatewayTimeout(apierr.CodeTranscribeTimeout, "Transcription timed out")
		}
		if err != nil {
			return err
		}
		return e.JSON(http.StatusOK, out)
	}).Bind(auth.RequireScope("transcribe"))
}
