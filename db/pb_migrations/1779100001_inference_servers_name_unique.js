/// <reference path="../pb_data/types.d.ts" />

// Forward fix for environments that already had the inference_servers collection without
// a unique-name index. Adds the name index without touching any other index — future
// migrations or hand-applied indexes survive both directions.

const NAME_INDEX = 'CREATE UNIQUE INDEX `idx_inference_servers_name` ON `inference_servers` (`name` COLLATE NOCASE)';

function indexName(sql) {
  const match = sql.match(/INDEX\s+`?([a-zA-Z0-9_]+)`?/i);
  return match ? match[1] : null;
}

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

    const existing = collection.indexes || [];
    if (!existing.some((sql) => indexName(sql) === 'idx_inference_servers_name')) {
      collection.indexes = [...existing, NAME_INDEX];
      app.save(collection);
    }
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

    const existing = collection.indexes || [];
    const next = existing.filter((sql) => indexName(sql) !== 'idx_inference_servers_name');
    if (next.length !== existing.length) {
      collection.indexes = next;
      app.save(collection);
    }
  },
);
