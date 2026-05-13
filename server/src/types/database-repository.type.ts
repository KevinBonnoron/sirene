import type { CreateDto, UpdateDto } from '@sirene/shared';
import type { RecordModel } from 'pocketbase';

/** Optional params for templated filters: pass `{:placeholder}` in the filter
 *  string and the values here. The repository runs them through `pb.filter()`
 *  so services never have to import PocketBase to build a safe query. */
export type FilterParams = Record<string, unknown>;

export type QueryOptions = {
  params?: FilterParams;
  sort?: string;
};

export type DatabaseRepository<T extends RecordModel> = {
  findOne: (id: string) => Promise<T | null>;
  findBy: (filter: string, options?: { params?: FilterParams }) => Promise<T | null>;
  findAllBy: (filter?: string, options?: QueryOptions) => Promise<T[]>;
  getOrCreate: (record: CreateDto<T>, filter: string, options?: { params?: FilterParams }) => Promise<T>;
  create: (record: CreateDto<T>) => Promise<T>;
  update: (id: T['id'], record: UpdateDto<T>) => Promise<T>;
  delete: (id: T['id']) => Promise<boolean>;
};
