import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';

/**
 * The chat is never closed: everything else opens over it. Keeping the openers
 * here means the top bar, composer and empty state can all reach a modal
 * without importing each other.
 */
@Injectable({ providedIn: 'root' })
export class DialogsService {
  private readonly dialog = inject(MatDialog);

  async openConnection(): Promise<void> {
    const { ConnectionDialog } = await import('../features/connection/connection-dialog');
    this.dialog.open(ConnectionDialog, {
      width: '34rem',
      maxWidth: '95vw',
      autoFocus: 'dialog',
    });
  }

  async openParameters(): Promise<void> {
    const { ParametersDialog } = await import('../features/generation/parameters-dialog');
    this.dialog.open(ParametersDialog, {
      width: '44rem',
      maxWidth: '95vw',
      autoFocus: 'dialog',
    });
  }
}
