package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// A custom model is only described by the worker holding it; without the descriptor kept
// here, a disabled server takes the name and the size with it.
func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("desired_models")
		if err != nil {
			return err
		}
		if col.Fields.GetByName("descriptor") != nil {
			return nil
		}
		col.Fields.Add(&core.JSONField{Name: "descriptor", MaxSize: 64000})
		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("desired_models")
		if err != nil {
			return nil
		}
		col.Fields.RemoveByName("descriptor")
		return app.Save(col)
	})
}
