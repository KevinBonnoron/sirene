package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// An admin edits the other accounts but never their role, and can never disable its own:
// the instance allows a single admin, so that would lock everyone out.
const adminEditsUsers = "(id = @request.auth.id || @request.auth.role = 'admin')" +
	" && @request.body.role:isset = false" +
	" && (id != @request.auth.id || @request.body.disabled:isset = false)"

func init() {
	m.Register(func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		if users.Fields.GetByName("disabled") == nil {
			users.Fields.Add(&core.BoolField{Name: "disabled"})
		}
		users.UpdateRule = types.Pointer(adminEditsUsers)
		// Refusing Sirene's own login route is not enough: PocketBase issues tokens through
		// its collection endpoints too, and the auth rule is what gates every one of them.
		users.AuthRule = types.Pointer("disabled = false")
		return app.Save(users)
	}, func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return nil
		}
		users.Fields.RemoveByName("disabled")
		users.UpdateRule = types.Pointer("id = @request.auth.id && @request.body.role:isset = false")
		users.AuthRule = types.Pointer("")
		return app.Save(users)
	})
}
