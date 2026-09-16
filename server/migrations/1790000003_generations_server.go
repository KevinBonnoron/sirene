package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("generations")
		if err != nil {
			return err
		}
		servers, err := app.FindCollectionByNameOrId("inference_servers")
		if err != nil {
			return err
		}
		col.Fields.Add(&core.RelationField{Name: "server", CollectionId: servers.Id, MaxSelect: 1})
		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("generations")
		if err != nil {
			return err
		}
		col.Fields.RemoveByName("server")
		return app.Save(col)
	})
}
