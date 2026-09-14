package api

import (
	"database/sql"
	"errors"
	"net/http"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/KevinBonnoron/sirene/server/internal/apierr"
	"github.com/KevinBonnoron/sirene/server/internal/auth"
)

// Restricted API keys only learn their own id and scopes: a third-party
// integration has no business reading the owner's email or admin status.
func registerMe(p *router.RouterGroup[*core.RequestEvent], d *Deps) {
	p.GET("/me", func(e *core.RequestEvent) error {
		id := auth.IdentityOf(e)
		if id.Restricted() {
			return e.JSON(http.StatusOK, map[string]any{"id": id.UserID, "scopes": id.Scopes})
		}
		user, err := e.App.FindRecordById("users", id.UserID)
		if errors.Is(err, sql.ErrNoRows) {
			return apierr.NotFound(apierr.CodeUserNotFound, "User not found")
		}
		if err != nil {
			return err
		}
		role := user.GetString("role")
		if role == "" {
			role = "user"
		}
		out := map[string]any{"id": user.Id, "email": user.Email(), "role": role, "scopes": nil}
		if name := user.GetString("name"); name != "" {
			out["name"] = name
		}
		return e.JSON(http.StatusOK, out)
	})
}
