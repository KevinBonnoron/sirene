package hooks

import "github.com/pocketbase/pocketbase/core"

// Counting inside the create hook runs in the insert's transaction; idx_users_single_admin guards concurrent registrations.
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
