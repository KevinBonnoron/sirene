import type { RecordModel } from 'pocketbase';
import { pb } from '../lib/pocketbase';
import type { DatabaseRepository, FilterParams } from '../types';

interface DatabaseRepositoryFactoryOptions {
  expand?: string;
}

/** Apply `pb.filter()` lazily so services can pass templated filters like
 *  `"user = {:userId}"` with a separate params dict, and never need to import
 *  PocketBase themselves. Returns the filter unchanged when no params given. */
function applyParams(filter: string | undefined, params: FilterParams | undefined): string | undefined {
  if (!filter || !params) {
    return filter;
  }
  return pb.filter(filter, params);
}

export function databaseRepositoryFactory<T extends RecordModel>(collectionName: string, { expand }: DatabaseRepositoryFactoryOptions = {}): DatabaseRepository<T> {
  const recordService = pb.collection<T>(collectionName);

  return {
    async findOne(id) {
      return recordService.getOne(id, { expand }).catch(() => null);
    },

    async findBy(filter, { params } = {}) {
      return recordService.getFirstListItem(applyParams(filter, params) ?? filter, { expand }).catch(() => null);
    },

    async findAllBy(filter, { params, sort = '-created' } = {}) {
      return recordService.getFullList({ filter: applyParams(filter, params), sort, expand }).catch(() => []);
    },

    async getOrCreate(record, filter, options) {
      const existingRecord = await this.findBy(filter, options);
      if (existingRecord) {
        return existingRecord;
      }

      return this.create(record);
    },

    async create(record) {
      return recordService.create(record);
    },

    async update(id, record) {
      return recordService.update(id, record);
    },

    async delete(id) {
      return recordService.delete(id);
    },
  };
}
