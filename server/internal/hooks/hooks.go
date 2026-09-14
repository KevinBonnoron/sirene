package hooks

import "github.com/pocketbase/pocketbase/core"

// The first account on an instance owns it. Counting inside the create hook
// runs in the same transaction as the insert, and the partial unique index
// idx_users_single_admin backs it up against concurrent registrations.
func Register(app core.App) {
	app.OnRecordCreate("users").BindFunc(func(e *core.RecordEvent) error {
		count, err := e.App.CountRecords("users")
		if err != nil {
			return err
		}
		if count == 0 {
			e.Record.Set("role", "admin")
		} else {
			e.Record.Set("role", "user")
		}
		return e.Next()
	})
}
