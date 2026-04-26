/// <reference path="../pb_data/types.d.ts" />

// Public session sharing.
// - Add `public` (bool) to `sessions` and `generations`.
// - Open viewRule on both so a non-authenticated request can read a public record by id.
// - listRule stays user-scoped: a public session is reachable by URL, not by listing.

migrate(
  (app) => {
    // ---- sessions ---------------------------------------------------------
    const sessions = app.findCollectionByNameOrId('sessions');

    sessions.fields.add(
      new Field({
        id: 'bool_session_public',
        name: 'public',
        type: 'bool',
        required: false,
        presentable: false,
        hidden: false,
        system: false,
      }),
    );

    sessions.viewRule = 'public = true || user = @request.auth.id';
    app.save(sessions);

    // ---- generations ------------------------------------------------------
    // Audio file URLs are gated by the parent collection's viewRule, so the public flag must
    // also live on each generation belonging to a shared session — denormalised by the server
    // when toggling. There's no reverse relation walk in PB rules that would let us key off
    // `session.public` here.
    const generations = app.findCollectionByNameOrId('generations');

    generations.fields.add(
      new Field({
        id: 'bool_generation_public',
        name: 'public',
        type: 'bool',
        required: false,
        presentable: false,
        hidden: false,
        system: false,
      }),
    );

    generations.viewRule = 'public = true || user = @request.auth.id';
    app.save(generations);
  },
  (app) => {
    // PB JSVM `findCollectionByNameOrId` throws when not found instead of returning null;
    // wrap so a missing collection skips the block rather than aborting the rollback.
    const findOrNull = (nameOrId) => {
      try {
        return app.findCollectionByNameOrId(nameOrId);
      } catch (e) {
        if (String(e).toLowerCase().includes('no rows')) {
          return null;
        }
        throw e;
      }
    };

    const sessions = findOrNull('sessions');
    if (sessions) {
      const f = sessions.fields.getByName('public');
      if (f) {
        sessions.fields.removeByName('public');
      }
      sessions.viewRule = 'user = @request.auth.id';
      app.save(sessions);
    }

    const generations = findOrNull('generations');
    if (generations) {
      const f = generations.fields.getByName('public');
      if (f) {
        generations.fields.removeByName('public');
      }
      generations.viewRule = 'user = @request.auth.id';
      app.save(generations);
    }
  },
);
