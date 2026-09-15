package sirene

import (
	"io/fs"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/plugins/migratecmd"
	"github.com/pocketbase/pocketbase/tools/osutils"

	"github.com/KevinBonnoron/sirene/server/internal/api"
	"github.com/KevinBonnoron/sirene/server/internal/apierr"
	"github.com/KevinBonnoron/sirene/server/internal/auth"
	"github.com/KevinBonnoron/sirene/server/internal/config"
	"github.com/KevinBonnoron/sirene/server/internal/generation"
	"github.com/KevinBonnoron/sirene/server/internal/hooks"
	"github.com/KevinBonnoron/sirene/server/internal/infsrv"
	"github.com/KevinBonnoron/sirene/server/internal/jobs"
	"github.com/KevinBonnoron/sirene/server/internal/models"
	"github.com/KevinBonnoron/sirene/server/internal/routing"
	"github.com/KevinBonnoron/sirene/server/internal/servermodels"
	"github.com/KevinBonnoron/sirene/server/internal/sessions"
	"github.com/KevinBonnoron/sirene/server/internal/settings"
	"github.com/KevinBonnoron/sirene/server/internal/voices"
	_ "github.com/KevinBonnoron/sirene/server/migrations"
	"github.com/KevinBonnoron/sirene/server/ui"
)

const maxBodySize = 100 << 20

type Options struct {
	// DataDir is PocketBase's data directory; empty keeps the --dir flag default.
	DataDir string
	// InferenceURL seeds the "Local" inference server.
	InferenceURL string
	// UIDir serves the web UI from disk instead of the embedded build.
	UIDir string
	// Automigrate writes Go migration files when collections change in the dashboard.
	Automigrate bool
	// MigrationsDir is where Automigrate writes.
	MigrationsDir string
}

func OptionsFromEnv() Options {
	cfg := config.FromEnv()
	return Options{
		InferenceURL:  cfg.InferenceURL,
		UIDir:         cfg.UIDir,
		Automigrate:   osutils.IsProbablyGoRun(),
		MigrationsDir: "migrations",
	}
}

func New(opts Options) *pocketbase.PocketBase {
	app := pocketbase.NewWithConfig(pocketbase.Config{DefaultDataDir: opts.DataDir})

	migratecmd.MustRegister(app, app.RootCmd, migratecmd.Config{
		Automigrate:  opts.Automigrate,
		Dir:          opts.MigrationsDir,
		TemplateLang: migratecmd.TemplateLangGo,
	})

	hooks.Register(app)

	keys := auth.NewAPIKeys(app)
	st := settings.New(app)
	servers := infsrv.New(app, opts.InferenceURL)
	cache := servermodels.New(app, servers)
	servers.SetOnChange(cache.Invalidate)
	rt := routing.New(servers, cache)
	store := jobs.New()
	voiceSvc := voices.New(app)
	modelSvc := models.New(app, servers, cache, rt, store, st)
	deps := &api.Deps{
		Config:     config.Config{InferenceURL: opts.InferenceURL, UIDir: opts.UIDir},
		Keys:       keys,
		CliAuth:    auth.NewCliAuth(keys),
		Settings:   st,
		Servers:    servers,
		Registry:   infsrv.NewRegistrations(),
		Cache:      cache,
		Router:     rt,
		Jobs:       store,
		Models:     modelSvc,
		Voices:     voiceSvc,
		Generation: generation.New(app, modelSvc, rt, voiceSvc),
		Sessions:   sessions.New(app),
	}

	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		// PocketBase defaults both to 5 minutes, which would cut SSE
		// subscriptions and long generation streams.
		se.Server.ReadTimeout = 0
		se.Server.WriteTimeout = 0
		se.Server.ReadHeaderTimeout = 30 * time.Second
		se.Server.IdleTimeout = 2 * time.Minute
		se.InstallerFunc = printInstallerLink

		se.Router.Unbind(apis.DefaultBodyLimitMiddlewareId)
		bodyLimit := apis.BodyLimit(maxBodySize)
		bodyLimit.Id = "sireneBodyLimit"
		se.Router.Bind(bodyLimit)

		if err := deps.Servers.Bootstrap(); err != nil {
			return err
		}
		deps.Servers.StartHealthLoop()

		api.Register(se, deps)

		// A catch-all per method rather than Any: an unmethoded pattern
		// conflicts with the GET-only SPA fallback in Go's ServeMux.
		notFound := func(e *core.RequestEvent) error {
			return e.JSON(http.StatusNotFound, map[string]string{"code": apierr.CodeNotFound, "message": "Not found"})
		}
		se.Router.GET("/api/{path...}", notFound)
		se.Router.POST("/api/{path...}", notFound)
		se.Router.PUT("/api/{path...}", notFound)
		se.Router.PATCH("/api/{path...}", notFound)
		se.Router.DELETE("/api/{path...}", notFound)
		se.Router.GET("/{path...}", apis.Static(uiFS(opts.UIDir), true))

		return se.Next()
	})

	app.OnTerminate().BindFunc(func(te *core.TerminateEvent) error {
		deps.Servers.Stop()
		deps.Models.Wait(10 * time.Second)
		deps.Jobs.Close()
		deps.Generation.Wait(10 * time.Second)
		return te.Next()
	})

	return app
}

// Serve runs the server in-process on addr until Shutdown is called; it is
// what embedders (the desktop app) use instead of the CLI.
func Serve(app *pocketbase.PocketBase, addr string) error {
	if err := app.Bootstrap(); err != nil {
		return err
	}
	if err := app.RunAllMigrations(); err != nil {
		return err
	}
	return apis.Serve(app, apis.ServeConfig{HttpAddr: addr, ShowStartBanner: false})
}

// Shutdown triggers the same termination path as SIGINT on the CLI.
func Shutdown(app *pocketbase.PocketBase) {
	_ = app.OnTerminate().Trigger(&core.TerminateEvent{App: app}, func(e *core.TerminateEvent) error {
		return e.App.ResetBootstrapState()
	})
}

func uiFS(dir string) fs.FS {
	if dir != "" {
		return os.DirFS(dir)
	}
	return ui.FS()
}

// PocketBase's default installer also opens a browser tab on every boot
// without a superuser, which gets in the way of headless runs and tests.
func printInstallerLink(app core.App, superuser *core.Record, baseURL string) error {
	token, err := superuser.NewStaticAuthToken(30 * time.Minute)
	if err != nil {
		return err
	}
	log.Printf("No dashboard superuser yet. Create one at %s/_/#/pbinstall/%s or run: sirene superuser upsert EMAIL PASS", strings.TrimRight(baseURL, "/"), token)
	return nil
}
