import PocketBase from 'pocketbase';
import { config } from './config';

export const pb = new PocketBase(config.pb.url);

// Restore token from localStorage if available
const storedToken = localStorage.getItem('sirene-auth-token');
if (storedToken) {
  pb.authStore.save(storedToken, null);
}
