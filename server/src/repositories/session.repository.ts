import { databaseRepositoryFactory } from '@server/factories';

export const sessionRepository = databaseRepositoryFactory('sessions');
