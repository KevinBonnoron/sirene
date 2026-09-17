package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Instance-wide configuration. `settings` cannot hold it: its `user` relation is required,
// so every row there belongs to someone. Every rule stays nil: the collection is reachable
// only through the admin-guarded API, never through the record endpoints.
func init() {
	m.Register(func(app core.App) error {
		col := core.NewBaseCollection("app_config")
		col.Fields.Add(&core.TextField{Name: "key", Required: true, Max: 100})
		col.Fields.Add(&core.TextField{Name: "value", Max: 2000})
		col.AddIndex("idx_app_config_key", true, "key", "")
		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("app_config")
		if err != nil {
			return nil
		}
		return app.Delete(col)
	})
}
