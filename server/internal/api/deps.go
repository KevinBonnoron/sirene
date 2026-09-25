package api

import (
	"github.com/KevinBonnoron/sirene/server/internal/appconfig"
	"github.com/KevinBonnoron/sirene/server/internal/auth"
	"github.com/KevinBonnoron/sirene/server/internal/bootstrap"
	"github.com/KevinBonnoron/sirene/server/internal/config"
	"github.com/KevinBonnoron/sirene/server/internal/generation"
	"github.com/KevinBonnoron/sirene/server/internal/infsrv"
	"github.com/KevinBonnoron/sirene/server/internal/jobs"
	"github.com/KevinBonnoron/sirene/server/internal/models"
	"github.com/KevinBonnoron/sirene/server/internal/routing"
	"github.com/KevinBonnoron/sirene/server/internal/servermodels"
	"github.com/KevinBonnoron/sirene/server/internal/sessions"
	"github.com/KevinBonnoron/sirene/server/internal/settings"
	"github.com/KevinBonnoron/sirene/server/internal/voices"
)

type Deps struct {
	Config     config.Config
	Keys       *auth.APIKeys
	Invites    *auth.Invites
	CliAuth    *auth.CliAuth
	Settings   *settings.Service
	AppConfig  *appconfig.Service
	Servers    *infsrv.Service
	Registry   *infsrv.Registrations
	Cache      *servermodels.Cache
	Router     *routing.Router
	Jobs       *jobs.Store
	Models     *models.Service
	Voices     *voices.Service
	Generation *generation.Service
	Sessions   *sessions.Service
	// Both empty outside the desktop app.
	DesktopSecret string
	Worker        *bootstrap.Status
}
