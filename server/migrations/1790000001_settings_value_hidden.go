package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Settings hold provider API keys; the API only ever returns them masked.
func init() {
	m.Register(func(app core.App) error {
		settings, err := app.FindCollectionByNameOrId("settings")
		if err != nil {
			return err
		}
		settings.Fields.GetByName("value").SetHidden(true)
		return app.Save(settings)
	}, func(app core.App) error {
		settings, err := app.FindCollectionByNameOrId("settings")
		if err != nil {
			return err
		}
		settings.Fields.GetByName("value").SetHidden(false)
		return app.Save(settings)
	})
}
