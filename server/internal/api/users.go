package api

import (
	"database/sql"
	"errors"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/KevinBonnoron/sirene/server/internal/apierr"
	"github.com/KevinBonnoron/sirene/server/internal/auth"
)

// Reading an account is a collection rule; deleting one is not, because what it owns has
// to go first and in order.
func registerUsers(p *router.RouterGroup[*core.RequestEvent]) {
	u := p.Group("/users")
	u.Bind(auth.RequireAdmin())

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
