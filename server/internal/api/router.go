package api

import (
	"net/http"

	"github.com/pocketbase/pocketbase/core"

	"github.com/KevinBonnoron/sirene/server/internal/auth"
	"github.com/KevinBonnoron/sirene/server/internal/config"
)

func Register(se *core.ServeEvent, d *Deps) {
	g := se.Router.Group("/api")
	g.Bind(auth.Envelope(), auth.Resolve(d.Keys))

	g.GET("/version", func(e *core.RequestEvent) error {
		return e.JSON(http.StatusOK, map[string]string{"version": config.Version, "name": "sirene"})
	})
	g.GET("/setup/status", func(e *core.RequestEvent) error {
		count, err := e.App.CountRecords("users")
		if err != nil {
			return err
		}
		return e.JSON(http.StatusOK, map[string]bool{"needsSetup": count == 0})
	})

	registerAuth(g, d)
	registerCliAuthPublic(g, d)
	registerInferenceServersPublic(g, d)
	registerOpenAPI(g)

	p := g.Group("")
	p.Bind(auth.RequireUser())

	registerCliAuthProtected(p, d)
	registerMe(p, d)
	registerAPIKeys(p, d)
	registerAppSettings(p, d)
	registerInferenceServers(p, d)
	registerJobs(p, d)
	registerModels(p, d)
	registerGenerate(p, d)
	registerGenerations(p, d)
	registerVoices(p, d)
	registerSessions(p, d)
	registerTranscribe(p, d)
	registerVoiceDesigner(p, d)
}
