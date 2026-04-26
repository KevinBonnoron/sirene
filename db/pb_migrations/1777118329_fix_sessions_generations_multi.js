/// <reference path="../pb_data/types.d.ts" />

// Phase 4 follow-up — for databases that already applied the original studio_sessions
// migration (which created `sessions.generations` with `maxSelect: null`), PocketBase 0.26
// interprets that as single-select and silently drops prior takes during a multi-id create.
// Force an explicit large `maxSelect` so the field is unambiguously multi-select. The
// snapshot has since been updated to create the field with maxSelect=999 directly, so on a
// fresh install this migration is a no-op (the field already has the correct shape).

// PB JSVM `findCollectionByNameOrId` throws when not found instead of returning null;
// wrap so a missing collection skips the block rather than aborting the migration.
const findOrNull = (app, nameOrId) => {
  try {
    return app.findCollectionByNameOrId(nameOrId);
  } catch (e) {
    if (String(e).toLowerCase().includes('no rows')) {
      return null;
    }
    throw e;
  }
};

migrate(
  (app) => {
    const sessions = findOrNull(app, 'sessions');
    if (!sessions) {
      return;
    }
    const field = sessions.fields.getByName('generations');
    if (field) {
      field.maxSelect = 999;
      app.save(sessions);
    }
  },
  // No-op rollback: the parent snapshot now creates `sessions.generations` with maxSelect=999
  // already, so reverting to maxSelect=null would reintroduce the single-select bug this fix
  // was added to prevent. Keep the multi-select shape on rollback.
  (_app) => {},
);
