package api

import (
	"database/sql"
	"errors"
	"net/http"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/KevinBonnoron/sirene/server/internal/apierr"
	"github.com/KevinBonnoron/sirene/server/internal/auth"
)

type userSummary struct {
	ID       string `json:"id"`
	Email    string `json:"email"`
	Name     string `json:"name"`
	Role     string `json:"role"`
	Avatar   string `json:"avatar,omitempty"`
	Verified bool   `json:"verified"`
	Created  string `json:"created"`
}

// Sirene admins are ordinary records with role=admin, not PocketBase superusers, so the
// collection hides the other users' emails from them; the listing goes through here instead.
func registerUsers(p *router.RouterGroup[*core.RequestEvent], d *Deps) {
	u := p.Group("/users")
	u.Bind(auth.RequireAdmin())

	u.GET("", func(e *core.RequestEvent) error {
		records, err := e.App.FindRecordsByFilter("users", "id != ''", "created", 0, 0)
		if err != nil {
			return err
		}
		out := make([]userSummary, 0, len(records))
		for _, rec := range records {
			out = append(out, userSummary{
				ID:       rec.Id,
				Email:    rec.Email(),
				Name:     rec.GetString("name"),
				Role:     rec.GetString("role"),
				Avatar:   rec.GetString("avatar"),
				Verified: rec.GetBool("verified"),
				Created:  rec.GetDateTime("created").String(),
			})
		}
		return e.JSON(http.StatusOK, out)
	})

	u.DELETE("/{id}", func(e *core.RequestEvent) error {
		id, err := pathParam(e, "id")
		if err != nil {
			return err
		}
		if id == e.Auth.Id {
			return apierr.Validation("an admin cannot delete their own account")
		}
		rec, err := e.App.FindRecordById("users", id)
		if errors.Is(err, sql.ErrNoRows) {
			return apierr.NotFound(apierr.CodeUserNotFound, "User not found")
		}
		if err != nil {
			return err
		}
		return e.App.RunInTransaction(func(tx core.App) error {
			// sessions point at generations, and generations at voices, both without cascade:
			// the user only becomes deletable once what it owns is gone, deepest reference first.
			for _, collection := range []string{"sessions", "generations", "voices", "settings"} {
				owned, err := tx.FindRecordsByFilter(collection, "user = {:user}", "", 0, 0, dbx.Params{"user": id})
				if err != nil {
					return err
				}
				for _, owns := range owned {
					if err := tx.Delete(owns); err != nil {
						return err
					}
				}
			}
			return tx.Delete(rec)
		})
	})
}
