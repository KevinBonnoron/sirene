package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("inference_servers")
		if err != nil {
			return err
		}
		col.Fields.Add(&core.TextField{Name: "registration", Max: 32})
		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("inference_servers")
		if err != nil {
			return err
		}
		col.Fields.RemoveByName("registration")
		return app.Save(col)
	})
}
