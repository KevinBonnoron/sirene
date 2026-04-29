/// <reference path="../pb_data/types.d.ts" />

// Adds an `is_admin` flag to users so admin-only HTTP routes (inference-server CRUD,
// future infrastructure endpoints) have an in-app authorization signal. The single-user
// product semantic is "the first registered user is the admin" — the migration promotes
// the oldest existing account on apply, and the register endpoint promotes the very
// first user when the table is empty.

migrate(
  (app) => {
    let collection;
    try {
      collection = app.findCollectionByNameOrId('users');
    } catch (e) {
      if (String(e).toLowerCase().includes('no rows')) {
        return;
      }
      throw e;
    }

    if (!collection.fields.getByName('is_admin')) {
      collection.fields.add(
        new Field({
          name: 'is_admin',
          type: 'bool',
          required: false,
        }),
      );
      app.save(collection);
    }

    // Partial unique index: at most one row can hold is_admin = true. Two concurrent
    // /register requests can each observe an empty table and both try to promote
    // themselves; the index makes the second update fail and the caller demotes back.
    const SINGLE_ADMIN_INDEX = 'CREATE UNIQUE INDEX `idx_users_single_admin` ON `users` (`is_admin`) WHERE `is_admin` = TRUE';
    const indexes = collection.indexes || [];
    if (!indexes.some((sql) => /idx_users_single_admin/.test(sql))) {
      collection.indexes = [...indexes, SINGLE_ADMIN_INDEX];
      app.save(collection);
    }

    // Promote the oldest user so an upgrade doesn't leave the deployment with zero admins.
    // findFirstRecordByFilter throws sql.ErrNoRows on a fresh install (empty users table),
    // so swallow that case explicitly — there's no one to promote yet, the register
    // handler will do it on the first signup. Also skip the write entirely if some user
    // is already flagged admin: re-running the migration on top of a deployment that
    // already has an admin would otherwise hit the partial unique index and abort.
    let existingAdmin = null;
    try {
      existingAdmin = app.findFirstRecordByFilter('users', 'is_admin = true');
    } catch (e) {
      if (!String(e).toLowerCase().includes('no rows')) {
        throw e;
      }
    }
    if (existingAdmin) {
      return;
    }
    let oldest = null;
    try {
      oldest = app.findFirstRecordByFilter('users', '1=1', '+created');
    } catch (e) {
      if (!String(e).toLowerCase().includes('no rows')) {
        throw e;
      }
    }
    if (oldest && oldest.get('is_admin') !== true) {
      oldest.set('is_admin', true);
      app.save(oldest);
    }
  },
  (app) => {
    let collection;
    try {
      collection = app.findCollectionByNameOrId('users');
    } catch (e) {
      if (String(e).toLowerCase().includes('no rows')) {
        return;
      }
      throw e;
    }

    const indexes = (collection.indexes || []).filter((sql) => !/idx_users_single_admin/.test(sql));
    if (indexes.length !== (collection.indexes || []).length) {
      collection.indexes = indexes;
      app.save(collection);
    }
    if (collection.fields.getByName('is_admin')) {
      collection.fields.removeByName('is_admin');
      app.save(collection);
    }
  },
);
