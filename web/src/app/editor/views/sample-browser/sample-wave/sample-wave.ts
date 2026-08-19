import { Component, input } from '@angular/core';

/**
 * A sample's min/max envelope, drawn.
 *
 * The path is built once per row by `sample-rows.ts` and only for a sample that
 * will actually be drawn; this is the box it goes in. Height is the caller's —
 * a bank slot's row is shorter than a file's — so only the aspect is fixed here.
 */
@Component({
  selector: 'amk-sample-wave',
  template: `
    <svg
      class="text-accent h-full w-full"
      viewBox="0 0 1 2"
      preserveAspectRatio="none"
      focusable="false"
    >
      <g transform="translate(0,1)">
        <path fill="currentColor" [attr.d]="d()" />
      </g>
    </svg>
  `,
  host: { class: 'block' },
})
export class SampleWave {
  readonly d = input.required<string>();
}
