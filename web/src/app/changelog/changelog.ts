import { Component } from '@angular/core';

import { IconBook } from '../shared/icons/icon-book';
import { Popover } from '../shared/popover/popover';
import { CHANGELOG } from './changelog-data';

/**
 * The top bar's changelog control and the panel it drops down.
 * The entries themselves live in `changelog-data.ts`, which is the file to edit.
 */
@Component({
  selector: 'amk-changelog',
  imports: [IconBook, Popover],
  templateUrl: './changelog.html',
})
export class Changelog {
  protected readonly entries = CHANGELOG;
}
