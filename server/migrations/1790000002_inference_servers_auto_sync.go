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
		col.Fields.Add(&core.BoolField{Name: "autoSync"})
		if err := app.Save(col); err != nil {
			return err
		}
		records, err := app.FindAllRecords("inference_servers")
		if err != nil {
			return err
		}
		for _, rec := range records {
			rec.Set("autoSync", true)
			if err := app.Save(rec); err != nil {
				return err
			}
		}
		return nil
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("inference_servers")
		if err != nil {
			return err
		}
		col.Fields.RemoveByName("autoSync")
		return app.Save(col)
	})
}
