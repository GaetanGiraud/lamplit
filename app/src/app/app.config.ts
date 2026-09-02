import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { LocalStorageBackend, STORAGE_BACKEND } from './store/storage';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: STORAGE_BACKEND, useExisting: LocalStorageBackend },
  ],
};
