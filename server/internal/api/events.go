package api

import (
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/KevinBonnoron/sirene/server/internal/auth"
	"github.com/KevinBonnoron/sirene/server/internal/jobs"
	"github.com/KevinBonnoron/sirene/server/internal/sse"
)

// One stream for the whole app: the catalogue and the job board are both open on every
// page, and a browser only grants six connections per origin.
func registerEvents(p *router.RouterGroup[*core.RequestEvent], d *Deps) {
	p.GET("/events", func(e *core.RequestEvent) error {
		w := sse.Begin(e)
		changes, unsubscribe := d.Models.Changes.Subscribe()
		defer unsubscribe()

		// Every job installs or removes a model, which only an admin can ask for.
		var board <-chan jobs.Update
		if auth.IsAdmin(e) {
			sub, snapshot := d.Jobs.Subscribe()
			defer d.Jobs.Unsubscribe(sub)
			board = sub.C
			if err := w.Event("jobs", mustJSON(snapshot)); err != nil {
				return nil
			}
		}

		ctx := e.Request.Context()
		for {
			select {
			case <-ctx.Done():
				return nil
			case <-changes:
				if err := w.Event("models", "1"); err != nil {
					return nil
				}
			case update, ok := <-board:
				if !ok {
					// A closed store must not spin the loop on a ready channel.
					board = nil
					continue
				}
				var err error
				if update.Removed {
					err = w.Event("job.removed", mustJSON(map[string]string{"id": update.ID}))
				} else {
					err = w.Event("job", mustJSON(update.Job))
				}
				if err != nil {
					return nil
				}
			}
		}
	}).Bind(apis.SkipSuccessActivityLog(), auth.RequireScope("models:read"))
}
