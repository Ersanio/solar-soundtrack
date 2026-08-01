import { Component, computed, inject } from '@angular/core';

import { Button } from '../../shared/button/button';
import { DriverStore } from '../../state/driver-store';
import { hex4 } from '../../util/format';

@Component({
  selector: 'amk-driver-picker',
  imports: [Button],
  templateUrl: './driver-picker.html',
})
export class DriverPicker {
  protected readonly drivers = inject(DriverStore);

  protected readonly loadAddress = computed(() => {
    const plan = this.drivers.plan();
    return plan ? `$${hex4(plan.localPos)}` : '—';
  });

  protected onFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void this.drivers.useCustom(file);
    input.value = ''; // allow re-picking the same file
  }
}
