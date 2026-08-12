import { Component, inject } from '@angular/core';

import { Changelog } from '../../changelog/changelog';
import { GIT_COMMIT_SHA } from '../../git-info.generated';
import { Button } from '../../shared/button/button';
import { IconGithub } from '../../shared/icons/icon-github';
import { EditorStore } from '../../state/editor-store';
import { TransportControls } from '../transport-controls/transport-controls';

const REPO_URL = 'https://github.com/Ersanio/solar-soundtrack';

@Component({
  selector: 'amk-top-bar',
  imports: [Button, Changelog, IconGithub, TransportControls],
  templateUrl: './top-bar.html',
  host: {
    class: 'border-edge bg-raised flex flex-wrap items-center gap-3 border-b px-4 py-2',
  },
})
export class TopBar {
  protected readonly store = inject(EditorStore);
  protected readonly commitUrl = `${REPO_URL}/commit/${GIT_COMMIT_SHA}`;
  protected readonly commitShort = GIT_COMMIT_SHA.slice(0, 7);
}
