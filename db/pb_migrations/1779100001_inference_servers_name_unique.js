/// <reference path="../pb_data/types.d.ts" />

// Forward fix for environments that already had the inference_servers collection without
// a unique-name index. Idempotent: skips if the collection or the index is already absent.

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

    const desired = ['CREATE UNIQUE INDEX `idx_inference_servers_name` ON `inference_servers` (`name` COLLATE NOCASE)', 'CREATE UNIQUE INDEX `idx_inference_servers_url` ON `inference_servers` (`url`)'];

    collection.indexes = desired;
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

    collection.indexes = ['CREATE UNIQUE INDEX `idx_inference_servers_url` ON `inference_servers` (`url`)'];
    app.save(collection);
  },
);
