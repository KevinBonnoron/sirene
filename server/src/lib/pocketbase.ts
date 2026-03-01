import PocketBase from 'pocketbase';
import { config } from './config';

export const pb = new PocketBase(config.pb.url).autoCancellation(false);

export async function initPocketBase() {
  try {
    await pb.collection('_superusers').authWithPassword(config.pb.adminEmail, config.pb.adminPassword);
    console.log('PocketBase admin authenticated');
  } catch {
    console.warn('PocketBase admin auth failed, continuing without auth');
  }
}
