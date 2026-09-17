package api

import (
	"net/http"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/KevinBonnoron/sirene/server/internal/apierr"
	"github.com/KevinBonnoron/sirene/server/internal/appconfig"
	"github.com/KevinBonnoron/sirene/server/internal/auth"
)

// Instance-wide configuration, as opposed to /app-settings which is per user.
func registerInstance(p *router.RouterGroup[*core.RequestEvent], d *Deps) {
	i := p.Group("/instance")
	i.Bind(auth.RequireAdmin())

	i.GET("", func(e *core.RequestEvent) error {
		enabled, err := d.AppConfig.Bool(appconfig.RegistrationEnabled, true)
		if err != nil {
			return err
		}
		return e.JSON(http.StatusOK, map[string]bool{appconfig.RegistrationEnabled: enabled})
	})

	i.PUT("", func(e *core.RequestEvent) error {
		var body map[string]bool
		if err := bindJSON(e, &body); err != nil {
			return err
		}
		if len(body) == 0 {
			return apierr.Validation("body: no setting given")
		}
		for key := range body {
			if !appconfig.IsKnownKey(key) {
				return apierr.Validation("unknown instance setting: " + key)
			}
		}
		for key, value := range body {
			if err := d.AppConfig.SetBool(key, value); err != nil {
				return err
			}
		}
		return e.JSON(http.StatusOK, body)
	})
}
