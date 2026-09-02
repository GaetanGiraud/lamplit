import { Injectable, InjectionToken } from '@angular/core';

/**
 * One document in, one document out. Step 3 replaces the implementation with
 * an HTTP-backed one; nothing above this line changes.
 */
export interface StorageBackend {
  read<T>(key: string): T | null;
  write(key: string, value: unknown): void;
  remove(key: string): void;
  keys(prefix: string): string[];
}

const NAMESPACE = 'magicstories';

@Injectable({ providedIn: 'root' })
export class LocalStorageBackend implements StorageBackend {
  read<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(this.full(key));
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch {
      // Private mode, blocked site data, or a document written by an older
      // version: behave as if nothing was stored.
      return null;
    }
  }

  write(key: string, value: unknown): void {
    try {
      localStorage.setItem(this.full(key), JSON.stringify(value));
    } catch {
      /* out of quota or storage blocked: the session still works, unsaved */
    }
  }

  remove(key: string): void {
    try {
      localStorage.removeItem(this.full(key));
    } catch {
      /* nothing to do */
    }
  }

  keys(prefix: string): string[] {
    const found: string[] = [];
    try {
      const full = this.full(prefix);
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(full)) found.push(key.slice(NAMESPACE.length + 1));
      }
    } catch {
      /* nothing to do */
    }
    return found;
  }

  private full(key: string): string {
    return `${NAMESPACE}:${key}`;
  }
}

export const STORAGE_BACKEND = new InjectionToken<StorageBackend>('StorageBackend');

export const STORAGE_KEYS = {
  settings: 'settings',
  chat: (id: string) => `chat:${id}`,
  activeChat: 'active-chat',
} as const;
