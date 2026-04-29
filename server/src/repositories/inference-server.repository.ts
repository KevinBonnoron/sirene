import type { InferenceServer } from '@sirene/shared';
import { databaseRepositoryFactory } from '../factories';

export const inferenceServerRepository = databaseRepositoryFactory<InferenceServer>('inference_servers');
