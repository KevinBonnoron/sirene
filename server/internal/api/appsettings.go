package api

import (
	"net/http"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/KevinBonnoron/sirene/server/internal/apierr"
	"github.com/KevinBonnoron/sirene/server/internal/auth"
	"github.com/KevinBonnoron/sirene/server/internal/settings"
)

// Mounted at /api/app-settings: PocketBase reserves /api/settings for itself.
func registerAppSettings(p *router.RouterGroup[*core.RequestEvent], d *Deps) {
	s := p.Group("/app-settings")

	s.GET("", func(e *core.RequestEvent) error {
		out, err := d.Settings.ListMasked(auth.IdentityOf(e).UserID)
		if err != nil {
			return err
		}
		return e.JSON(http.StatusOK, out)
	}).Bind(auth.RequireScope("settings:read"))

	s.PUT("", func(e *core.RequestEvent) error {
		var body struct {
			Key   *string `json:"key"`
			Value *string `json:"value"`
		}
		if err := bindJSON(e, &body); err != nil {
			return err
		}
		if body.Key == nil || !settings.ValidKey(*body.Key) {
			return apierr.Validation("key: invalid setting key")
		}
		if body.Value == nil {
			return apierr.Validation("value: required")
		}
		if err := d.Settings.Set(*body.Key, *body.Value, auth.IdentityOf(e).UserID); err != nil {
			return err
		}
		return e.JSON(http.StatusOK, map[string]bool{"success": true})
	}).Bind(auth.RequireScope("settings:write"))

	s.DELETE("/{key}", func(e *core.RequestEvent) error {
		key := e.Request.PathValue("key")
		if !settings.ValidKey(key) {
			return apierr.Validation("key: invalid setting key")
		}
		if err := d.Settings.Delete(key, auth.IdentityOf(e).UserID); err != nil {
			return err
		}
		return e.JSON(http.StatusOK, map[string]bool{"success": true})
	}).Bind(auth.RequireScope("settings:write"))
}
