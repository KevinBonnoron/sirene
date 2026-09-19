package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Invitations let an admin open a door for one person without opening registration for
// everyone. Every rule stays nil: the collection is reachable only through the API.
func init() {
	m.Register(func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		col := core.NewBaseCollection("invitations")
		col.Fields.Add(&core.EmailField{Name: "email", Required: true})
		col.Fields.Add(&core.TextField{Name: "hash", Required: true, Max: 64})
		col.Fields.Add(&core.RelationField{Name: "invitedBy", CollectionId: users.Id, MaxSelect: 1, CascadeDelete: true})
		col.Fields.Add(&core.DateField{Name: "expiresAt", Required: true})
		col.Fields.Add(&core.DateField{Name: "acceptedAt"})
		col.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
		col.AddIndex("idx_invitations_hash", true, "hash", "")
		col.AddIndex("idx_invitations_pending_email", true, "email", "acceptedAt = ''")
		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("invitations")
		if err != nil {
			return nil
		}
		return app.Delete(col)
	})
}
