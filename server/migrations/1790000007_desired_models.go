package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// What the operator asked for, as opposed to what the workers happen to hold. Every rule
// stays nil: the collection is reachable only through the admin-guarded model routes.
func init() {
	m.Register(func(app core.App) error {
		col := core.NewBaseCollection("desired_models")
		col.Fields.Add(&core.TextField{Name: "model", Required: true, Max: 200})
		col.AddIndex("idx_desired_models_model", true, "model", "")
		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("desired_models")
		if err != nil {
			return nil
		}
		return app.Delete(col)
	})
}
