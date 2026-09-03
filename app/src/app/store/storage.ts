import { InjectionToken } from '@angular/core';

/**
 * How the stores get at documents: one document in, one document out, all of it
 * synchronous.
 *
 * Synchronous because the stores are built on signals and read at construction
 * — a story switch asks for that story's chapters and expects them there and
 * then. The documents behind this are held in memory for the length of the
 * session, put there once at startup by the server, which is the only place
 * they actually live. See {@link Persistence}.
 */
export interface StorageBackend {
  read<T>(key: string): T | null;
  write(key: string, value: unknown): void;
  remove(key: string): void;
  keys(prefix: string): string[];
}

export const STORAGE_BACKEND = new InjectionToken<StorageBackend>('StorageBackend');
