import type { CreateDto, UpdateDto } from '@sirene/shared';
import type { RecordModel } from 'pocketbase';

export type DatabaseRepository<T extends RecordModel> = {
  getOne: (id: string) => Promise<T | null>;
  getOneBy: (filter: string) => Promise<T | null>;
  getAllBy: (filter?: string, options?: { sort?: string }) => Promise<T[]>;
  getOrCreate: (record: CreateDto<T>, filter: string) => Promise<T>;
  create: (record: CreateDto<T>) => Promise<T>;
  update: (id: T['id'], record: UpdateDto<T>) => Promise<T>;
  delete: (id: T['id']) => Promise<boolean>;
};
