import { Component, inject } from '@angular/core';
import { NoServer } from './shared/no-server';
import { Persistence } from './store/persistence';
import { Workspace } from './workspace';

/**
 * Which of the two things there is to show: the app, or the reason there isn't
 * one. Nothing else lives here, so that a session without a server never
 * constructs a store.
 */
@Component({
  selector: 'app-root',
  imports: [NoServer, Workspace],
  template: `
    @if (persistence.ready()) {
      <ms-workspace />
    } @else {
      <ms-no-server />
    }
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
    }

    ms-workspace {
      height: 100%;
    }
  `,
})
export class App {
  protected readonly persistence = inject(Persistence);
}
