/// <reference path="../pb_data/types.d.ts" />

// Phase 2 — Studio data layer
// - Extend `generations`: add `state`, `tuning`, `ssml_json`
// - Create `sessions` collection (ordered relation to generations, no back-ref)

migrate(
  (app) => {
    // ---- 1. Extend generations --------------------------------------------
    const generations = app.findCollectionByNameOrId('generations');

    generations.fields.add(
      new Field({
        id: 'select_state',
        name: 'state',
        type: 'select',
        maxSelect: 1,
        values: ['draft', 'ready', 'tuned'],
        required: false,
        presentable: false,
        hidden: false,
        system: false,
      }),
    );

    generations.fields.add(
      new Field({
        id: 'json_tuning',
        name: 'tuning',
        type: 'json',
        maxSize: 0,
        required: false,
        presentable: false,
        hidden: false,
        system: false,
      }),
    );

    generations.fields.add(
      new Field({
        id: 'json_ssml',
        name: 'ssml_json',
        type: 'json',
        maxSize: 0,
        required: false,
        presentable: false,
        hidden: false,
        system: false,
      }),
    );

    app.save(generations);

    // ---- 2. Create sessions -----------------------------------------------
    const sessions = new Collection({
      id: 'pbc_sessions_studio',
      name: 'sessions',
      type: 'base',
      system: false,
      createRule: "@request.auth.id != '' && @request.body.user = @request.auth.id",
      listRule: 'user = @request.auth.id',
      viewRule: 'user = @request.auth.id',
      updateRule: "@request.auth.id != '' && user = @request.auth.id && (@request.body.user:isset = false || @request.body.user = @request.auth.id)",
      deleteRule: 'user = @request.auth.id',
      fields: [
        {
          id: 'text3208210256',
          name: 'id',
          type: 'text',
          system: true,
          primaryKey: true,
          required: true,
          autogeneratePattern: '[a-z0-9]{15}',
          pattern: '^[a-z0-9]+$',
          min: 15,
          max: 15,
          presentable: false,
          hidden: false,
        },
        {
          id: 'text_session_name',
          name: 'name',
          type: 'text',
          system: false,
          required: false,
          presentable: false,
          hidden: false,
          autogeneratePattern: '',
          pattern: '',
          min: 0,
          max: 120,
          primaryKey: false,
        },
        {
          id: 'relation_session_user',
          name: 'user',
          type: 'relation',
          system: false,
          required: true,
          cascadeDelete: false,
          collectionId: '_pb_users_auth_',
          maxSelect: 1,
          minSelect: 0,
          presentable: false,
          hidden: false,
        },
        {
          id: 'relation_session_generations',
          name: 'generations',
          type: 'relation',
          system: false,
          required: false,
          cascadeDelete: false,
          collectionId: 'pbc_1512514359',
          // Large explicit maxSelect — PB 0.26 treats null/0 as single-select. The follow-up
          // migration 1777118329_fix_sessions_generations_multi.js exists for installs that
          // already applied this snapshot before the fix.
          maxSelect: 999,
          minSelect: 0,
          presentable: false,
          hidden: false,
        },
        {
          id: 'autodate2990389176',
          name: 'created',
          type: 'autodate',
          system: false,
          onCreate: true,
          onUpdate: false,
          presentable: false,
          hidden: false,
        },
        {
          id: 'autodate3332085495',
          name: 'updated',
          type: 'autodate',
          system: false,
          onCreate: true,
          onUpdate: true,
          presentable: false,
          hidden: false,
        },
      ],
      indexes: [],
    });

    app.save(sessions);
  },
  (app) => {
    // ---- Down migration ---------------------------------------------------
    // PB JSVM `findCollectionByNameOrId` throws when not found instead of returning null,
    // so we wrap each lookup so a missing collection skips its block instead of aborting.
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
      app.delete(sessions);
    }

    const generations = findOrNull('generations');
    if (generations) {
      for (const fieldName of ['state', 'tuning', 'ssml_json']) {
        const field = generations.fields.getByName(fieldName);
        if (field) {
          generations.fields.removeByName(fieldName);
        }
      }
      app.save(generations);
    }
  },
);
