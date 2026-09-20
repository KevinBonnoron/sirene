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

	// A password someone else chose is one its owner has to replace; changing your own
	// clears the obligation. Only the request hook knows who is asking.
	app.OnRecordUpdateRequest("users").BindFunc(func(e *core.RecordRequestEvent) error {
		info, err := e.RequestInfo()
		if err != nil {
			return err
		}
		if _, sets := info.Body["password"]; sets {
			e.Record.Set("mustChangePassword", e.Auth != nil && e.Auth.Id != e.Record.Id)
		}
		return e.Next()
	})

	// Refusing the next sign-in is not enough: without rotating the token key, whoever was
	// already signed in stays signed in until their token expires on its own.
	app.OnRecordUpdate("users").BindFunc(func(e *core.RecordEvent) error {
		if e.Record.GetBool("disabled") && !e.Record.Original().GetBool("disabled") {
			e.Record.RefreshTokenKey()
		}
		return e.Next()
	})
}
