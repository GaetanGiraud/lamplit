import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { Persistence } from './store/persistence';
import { STORAGE_BACKEND } from './store/storage';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: STORAGE_BACKEND, useExisting: Persistence },
    // Every document the session will read, fetched once, before anything can
    // ask for one. The app renders a failure screen rather than starting if
    // this does not come back — there is nothing to show without it.
    provideAppInitializer(() => inject(Persistence).load()),
  ],
};
