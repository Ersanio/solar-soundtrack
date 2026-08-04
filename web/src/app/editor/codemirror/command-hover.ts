import type { Extension } from '@codemirror/state';
import { hoverTooltip } from '@codemirror/view';

import { type Command, commandAt } from '@compiler/tokens';
import { hex2 } from '../../util/format';

/** One line of the tooltip, styled by the classes the theme defines. */
function line(className: string, text: string): HTMLElement {
  const element = document.createElement('div');
  element.className = className;
  element.textContent = text;
  return element;
}

function renderCommand(command: Command): HTMLElement {
  const dom = document.createElement('div');
  dom.className = 'cm-amk-hover';

  const label = command.vcmd !== undefined ? `$${hex2(command.vcmd)}` : command.kind;
  const via = command.replacement !== undefined ? ` via ${command.replacement}` : '';
  dom.appendChild(line('cm-amk-hover-name', `${label} ${command.name}${via}`));

  if (command.args.length > 0) {
    const args =
      command.vcmd !== undefined
        ? command.args.map((arg) => `$${hex2(arg.value & 0xff)}`).join(' ')
        : command.args.map((arg) => arg.value).join(', ');
    dom.appendChild(line('cm-amk-hover-args', args));
  }

  if (!command.complete) {
    dom.appendChild(line('cm-amk-hover-incomplete', 'incomplete — expects more arguments'));
  }

  return dom;
}

/**
 * A tooltip naming the command under the pointer, from the same scan the
 * command inspector reads — hover is the quick glance, the panel the full
 * story, and the panel (following the caret) is the keyboard-reachable
 * equivalent of this pointer-only affordance.
 *
 * `commands` is a thunk so each hover reads the current scan; the computed
 * behind it is cached, so this costs a lookup, not a re-tokenize.
 */
export function commandHover(commands: () => Command[]): Extension {
  return hoverTooltip((_view, pos) => {
    const command = commandAt(commands(), pos);
    if (!command) {
      return null;
    }

    return {
      pos: command.span.start,
      end: command.span.end,
      above: true,
      create: () => ({ dom: renderCommand(command) }),
    };
  });
}
