import type { RecordModel } from 'pocketbase';
import { pb } from '../lib/pocketbase';
import type { DatabaseRepository } from '../types';

interface DatabaseRepositoryFactoryOptions {
  expand?: string;
}

export function databaseRepositoryFactory<T extends RecordModel>(collectionName: string, { expand }: DatabaseRepositoryFactoryOptions = {}): DatabaseRepository<T> {
  const recordService = pb.collection<T>(collectionName);

  return {
    async getOne(id) {
      return recordService.getOne(id, { expand }).catch(() => null);
    },

    async getOneBy(filter) {
      return recordService.getFirstListItem(filter, { expand }).catch(() => null);
    },

    async getAllBy(filter, options) {
      return recordService.getFullList({ filter, sort: options?.sort ?? '-created', expand }).catch(() => []);
    },

    async getOrCreate(record, filter) {
      const existingRecord = await this.getOneBy(filter);
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
