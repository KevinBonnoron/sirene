import { databaseRepositoryFactory } from '@server/factories';

export const generationRepository = databaseRepositoryFactory('generations', { expand: 'voice' });
