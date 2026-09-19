package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

const adminListsUsers = "id = @request.auth.id || @request.auth.role = 'admin'"

// An admin is an ordinary record, not a superuser, so the collection would hide the other
// accounts' emails: the manage rule lifts that. It grants no write access on its own —
// updateRule still only lets a record edit itself.
func init() {
	m.Register(func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		users.ListRule = types.Pointer(adminListsUsers)
		users.ManageRule = types.Pointer(adminOnly)
		if err := app.Save(users); err != nil {
			return err
		}
		invitations, err := app.FindCollectionByNameOrId("invitations")
		if err != nil {
			return err
		}
		if hash, ok := invitations.Fields.GetByName("hash").(*core.TextField); ok {
			hash.Hidden = true
		}
		invitations.ListRule = types.Pointer(adminOnly)
		invitations.ViewRule = types.Pointer(adminOnly)
		invitations.DeleteRule = types.Pointer(adminOnly)
		return app.Save(invitations)
	}, func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		users.ListRule = types.Pointer("id = @request.auth.id")
		users.ManageRule = nil
		if err := app.Save(users); err != nil {
			return err
		}
		invitations, err := app.FindCollectionByNameOrId("invitations")
		if err != nil {
			return nil
		}
		invitations.ListRule = nil
		invitations.ViewRule = nil
		invitations.DeleteRule = nil
		return app.Save(invitations)
	})
}
