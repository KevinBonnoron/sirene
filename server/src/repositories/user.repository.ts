import { databaseRepositoryFactory } from '@server/factories';
import type { User } from '@sirene/shared';

export const userRepository = databaseRepositoryFactory<User>('users');
