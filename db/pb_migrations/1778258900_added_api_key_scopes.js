/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3577178630");

  collection.fields.add(new Field({
    "hidden": false,
    "id": "json3556729941",
    "maxSize": 0,
    "name": "scopes",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }));

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3577178630");

  collection.fields.removeById("json3556729941");

  return app.save(collection);
})
