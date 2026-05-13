import { databaseRepositoryFactory } from '@server/factories';
import type { ApiKey } from '@sirene/shared';

export const apiKeyRepository = databaseRepositoryFactory<ApiKey>('api_keys');
