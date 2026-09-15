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
		col.Fields.Add(&core.SelectField{Name: "syncPolicy", Values: []string{"all", "cpu", "gpu", "none"}, MaxSelect: 1})
		if err := app.Save(col); err != nil {
			return err
		}
		records, err := app.FindAllRecords("inference_servers")
		if err != nil {
			return err
		}
		for _, rec := range records {
			rec.Set("syncPolicy", "all")
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
		col.Fields.RemoveByName("syncPolicy")
		return app.Save(col)
	})
}
