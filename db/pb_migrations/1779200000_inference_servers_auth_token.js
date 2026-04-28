/// <reference path="../pb_data/types.d.ts" />

// Adds an `auth_token` field to inference_servers used for outbound auth between the Hono
// server and remote inference servers. Marked hidden so PB never returns it to clients —
// only admin queries (used by the server-side repository) can read it.

migrate(
  (app) => {
    let collection;
    try {
      collection = app.findCollectionByNameOrId('inference_servers');
    } catch (e) {
      if (String(e).toLowerCase().includes('no rows')) {
        return;
      }
      throw e;
    }

    collection.fields.add(
      new Field({
        name: 'auth_token',
        type: 'text',
        required: false,
        max: 200,
        hidden: true,
        system: false,
      }),
    );

    app.save(collection);
  },
  (app) => {
    let collection;
    try {
      collection = app.findCollectionByNameOrId('inference_servers');
    } catch (e) {
      if (String(e).toLowerCase().includes('no rows')) {
        return;
      }
      throw e;
    }

    const f = collection.fields.getByName('auth_token');
    if (f) {
      collection.fields.removeByName('auth_token');
      app.save(collection);
    }
  },
);
