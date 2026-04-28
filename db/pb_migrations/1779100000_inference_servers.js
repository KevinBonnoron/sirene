/// <reference path="../pb_data/types.d.ts" />

// Multi-server inference: registry of inference servers.
// Globally scoped (not per-user) — inference servers are shared infrastructure.

migrate(
  (app) => {
    const collection = new Collection({
      name: 'inference_servers',
      type: 'base',
      // Any authenticated user can list/view/create/update/delete servers.
      // Single-user product; tighten later if multi-tenant becomes a goal.
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.id != ''",
      fields: [
        {
          name: 'id',
          type: 'text',
          primaryKey: true,
          required: true,
          system: true,
          min: 15,
          max: 15,
          pattern: '^[a-z0-9]+$',
          autogeneratePattern: '[a-z0-9]{15}',
        },
        {
          name: 'name',
          type: 'text',
          required: true,
          max: 100,
        },
        {
          name: 'url',
          type: 'text',
          required: true,
          max: 2048,
        },
        {
          name: 'enabled',
          type: 'bool',
          required: false,
        },
        {
          name: 'priority',
          type: 'number',
          required: false,
          onlyInt: true,
        },
        {
          name: 'last_health_at',
          type: 'date',
          required: false,
        },
        {
          name: 'last_health_status',
          type: 'select',
          required: false,
          maxSelect: 1,
          values: ['online', 'offline', 'unknown'],
        },
        {
          name: 'last_health_error',
          type: 'text',
          required: false,
          max: 500,
        },
        {
          name: 'created',
          type: 'autodate',
          onCreate: true,
          onUpdate: false,
          system: true,
        },
        {
          name: 'updated',
          type: 'autodate',
          onCreate: true,
          onUpdate: true,
          system: true,
        },
      ],
      // NOCASE so `Local` and `local` collide and the user gets a clear field-level error.
      indexes: ['CREATE UNIQUE INDEX `idx_inference_servers_name` ON `inference_servers` (`name` COLLATE NOCASE)', 'CREATE UNIQUE INDEX `idx_inference_servers_url` ON `inference_servers` (`url`)'],
    });

    app.save(collection);
  },
  (app) => {
    try {
      const collection = app.findCollectionByNameOrId('inference_servers');
      app.delete(collection);
    } catch (e) {
      if (!String(e).toLowerCase().includes('no rows')) {
        throw e;
      }
    }
  },
);
