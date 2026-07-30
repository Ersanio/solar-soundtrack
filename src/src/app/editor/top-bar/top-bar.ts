import { Component, inject } from '@angular/core';

import { Button } from '../../shared/button/button';
import { Checkbox } from '../../shared/checkbox/checkbox';
import { EditorStore } from '../../state/editor-store';
import { TransportControls } from '../transport-controls/transport-controls';

@Component({
  selector: 'amk-top-bar',
  imports: [Button, Checkbox, TransportControls],
  templateUrl: './top-bar.html',
  host: {
    class: 'border-edge bg-raised flex flex-wrap items-center gap-3 border-b px-4 py-2',
  },
})
export class TopBar {
  protected readonly store = inject(EditorStore);
}
