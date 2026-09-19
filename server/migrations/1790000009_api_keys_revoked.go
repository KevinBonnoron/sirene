package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Revoking a key keeps the record: what a key was named, and when it stopped working, is
// the only trace left of what once had access.
func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("api_keys")
		if err != nil {
			return err
		}
		if col.Fields.GetByName("revokedAt") != nil {
			return nil
		}
		col.Fields.Add(&core.DateField{Name: "revokedAt"})
		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("api_keys")
		if err != nil {
			return nil
		}
		col.Fields.RemoveByName("revokedAt")
		return app.Save(col)
	})
}
