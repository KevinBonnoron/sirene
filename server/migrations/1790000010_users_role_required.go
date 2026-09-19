package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		// Accounts created before the hook that assigns a role carry an empty one.
		stale, err := app.FindRecordsByFilter(users, "role = ''", "", 0, 0)
		if err != nil {
			return err
		}
		for _, rec := range stale {
			rec.Set("role", "user")
			if err := app.SaveNoValidate(rec); err != nil {
				return err
			}
		}
		field, ok := users.Fields.GetByName("role").(*core.SelectField)
		if !ok {
			return nil
		}
		field.Required = true
		return app.Save(users)
	}, func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return nil
		}
		field, ok := users.Fields.GetByName("role").(*core.SelectField)
		if !ok {
			return nil
		}
		field.Required = false
		return app.Save(users)
	})
}
