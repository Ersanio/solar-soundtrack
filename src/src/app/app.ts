import { Component } from '@angular/core';

import { EditorPane } from './editor/editor-pane/editor-pane';
import { TopBar } from './editor/top-bar/top-bar';
import { OutputPane } from './output/output-pane/output-pane';

@Component({
  selector: 'amk-root',
  imports: [TopBar, EditorPane, OutputPane],
  templateUrl: './app.html',
  host: { class: 'flex h-screen flex-col' },
})
export class App {}
