import { config } from '../lib/config';
import { pb } from '../lib/pocketbase';

/** Wraps the two PB-file concerns services kept reaching into pb for:
 *  - building the `/api/files/<collection>/<id>/<filename>` URL
 *  - attaching the admin token so files behind restrictive view rules can be
 *    fetched server-side
 *  Public files (covered by a permissive listRule) can still be fetched with
 *  plain `fetch(pbFilesService.url(...))`; we keep the helper minimal. */
class PbFilesService {
  public url(collection: string, recordId: string, filename: string): string {
    return `${config.pb.url}/api/files/${collection}/${recordId}/${filename}`;
  }

  public fetchAuthed(collection: string, recordId: string, filename: string, init?: RequestInit): Promise<Response> {
    return fetch(this.url(collection, recordId, filename), {
      ...init,
      headers: {
        ...init?.headers,
        Authorization: pb.authStore.token,
      },
    });
  }
}

export const pbFilesService = new PbFilesService();
