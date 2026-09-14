package migrations

import (
	_ "embed"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

//go:embed collections_snapshot.json
var collectionsSnapshot []byte

func init() {
	m.Register(func(app core.App) error {
		return app.ImportCollectionsByMarshaledJSON(collectionsSnapshot, false)
	}, func(app core.App) error {
		return nil
	})
}
