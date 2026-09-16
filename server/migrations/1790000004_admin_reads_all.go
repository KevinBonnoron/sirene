package migrations

import (
	"strings"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

const (
	adminOnly = "@request.auth.role = 'admin'"
	adminRule = " || " + adminOnly
)

// A nil rule means locked; admins then become the only readers instead of being appended to nobody.
func withAdmin(rule *string) *string {
	if rule == nil {
		return types.Pointer(adminOnly)
	}
	return types.Pointer(*rule + adminRule)
}

func withoutAdmin(rule *string) *string {
	if rule == nil || *rule == adminOnly {
		return nil
	}
	return types.Pointer(strings.TrimSuffix(*rule, adminRule))
}

// Admins list every generation for the per-server view and expand its user and voice.
func init() {
	apply := func(app core.App, name string, list, view bool) error {
		col, err := app.FindCollectionByNameOrId(name)
		if err != nil {
			return err
		}
		if list {
			col.ListRule = withAdmin(col.ListRule)
		}
		if view {
			col.ViewRule = withAdmin(col.ViewRule)
		}
		return app.Save(col)
	}
	revert := func(app core.App, name string, list, view bool) error {
		col, err := app.FindCollectionByNameOrId(name)
		if err != nil {
			return err
		}
		if list {
			col.ListRule = withoutAdmin(col.ListRule)
		}
		if view {
			col.ViewRule = withoutAdmin(col.ViewRule)
		}
		return app.Save(col)
	}
	m.Register(func(app core.App) error {
		if err := apply(app, "generations", true, true); err != nil {
			return err
		}
		if err := apply(app, "users", false, true); err != nil {
			return err
		}
		return apply(app, "voices", false, true)
	}, func(app core.App) error {
		if err := revert(app, "generations", true, true); err != nil {
			return err
		}
		if err := revert(app, "users", false, true); err != nil {
			return err
		}
		return revert(app, "voices", false, true)
	})
}
