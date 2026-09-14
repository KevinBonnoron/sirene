package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

const usersSingleAdminIndex = "idx_users_single_admin"

func init() {
	m.Register(func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}

		admins, err := app.FindRecordsByFilter(users, "role = 'admin'", "created", 0, 0)
		if err != nil {
			return err
		}
		for _, extra := range admins[min(1, len(admins)):] {
			extra.Set("role", "user")
			if err := app.SaveNoValidate(extra); err != nil {
				return err
			}
		}

		users.CreateRule = types.Pointer("@request.body.role:isset = false")
		users.AuthAlert.Enabled = false
		users.RemoveIndex(usersSingleAdminIndex)
		users.AddIndex(usersSingleAdminIndex, true, "role", "role = 'admin'")
		return app.Save(users)
	}, func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		users.CreateRule = types.Pointer("")
		users.AuthAlert.Enabled = true
		users.RemoveIndex(usersSingleAdminIndex)
		return app.Save(users)
	})
}
