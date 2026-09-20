package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Nothing forbade the field in a request body, so an account under the obligation could
// simply clear it on itself. Only the update hook sets it, from who is asking.
const usersUpdateRule = "(id = @request.auth.id || @request.auth.role = 'admin')" +
	" && @request.body.role:isset = false" +
	" && @request.body.mustChangePassword:isset = false" +
	" && (id != @request.auth.id || @request.body.disabled:isset = false)"

func init() {
	m.Register(func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		users.UpdateRule = types.Pointer(usersUpdateRule)
		return app.Save(users)
	}, func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return nil
		}
		users.UpdateRule = types.Pointer(adminEditsUsers)
		return app.Save(users)
	})
}
