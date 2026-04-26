/// <reference path="../pb_data/types.d.ts" />

// Phase 4 follow-up — the previous migration created `sessions.generations` with
// `maxSelect: null`, which PocketBase 0.26 interprets as single-select. That caused
// `pb.collection('sessions').create({ generations: [a, b] })` to keep only the last id,
// silently dropping prior takes when auto-promoting solo → session. Force an explicit
// large `maxSelect` so the field is unambiguously multi-select.

migrate(
  (app) => {
    const sessions = app.findCollectionByNameOrId('sessions');
    if (!sessions) {
      return;
    }
    const field = sessions.fields.getByName('generations');
    if (field) {
      field.maxSelect = 999;
      app.save(sessions);
    }
  },
  (app) => {
    const sessions = app.findCollectionByNameOrId('sessions');
    if (!sessions) {
      return;
    }
    const field = sessions.fields.getByName('generations');
    if (field) {
      field.maxSelect = null;
      app.save(sessions);
    }
  },
);
