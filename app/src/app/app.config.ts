import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { STORAGE_BACKEND } from './store/storage';
import { SyncService, SyncedStorageBackend } from './store/sync';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: STORAGE_BACKEND, useExisting: SyncedStorageBackend },
    // Before anything reads a document: find out whether a server is holding
    // them, and if so reconcile the cache with it. Without one the app runs
    // exactly as it did in step 2, on `localStorage` alone.
    provideAppInitializer(() => inject(SyncService).bootstrap()),
  ],
};
