import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { SwUpdate, type VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs';

import { Button } from '../shared/button/button';

@Component({
  selector: 'amk-update-banner',
  imports: [Button],
  templateUrl: './update-banner.html',
})
export class UpdateBanner {
  private readonly swUpdate = inject(SwUpdate);

  private readonly versionReady = toSignal(
    this.swUpdate.versionUpdates.pipe(
      filter((event): event is VersionReadyEvent => event.type === 'VERSION_READY'),
    ),
    { initialValue: undefined },
  );

  private readonly dismissed = signal(false);

  protected readonly visible = computed(() => !!this.versionReady() && !this.dismissed());

  protected reload(): void {
    location.reload();
  }

  protected dismiss(): void {
    this.dismissed.set(true);
  }
}
