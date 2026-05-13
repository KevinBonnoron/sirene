// Codes are defined in `@sirene/shared` so both server (throw site) and client
// (i18n translation) reference the same union. Re-exported here for ergonomic
// imports inside the server (`from '../errors'`).
export type { ErrorCode } from '@sirene/shared';
