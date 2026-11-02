/**
 * The message of every `SST` diagnostic: findings this tool makes that AddmusicK does not.
 *
 * Keyed by code, then by variant where one code says several things. Each entry is a function so
 * nothing builds a message at import. The words are under the same ID in
 * web/src/locale/messages.en.json.
 */
export const SST = {
	"0301": (address: string) => $localize`:@@sst.0301:sst.0301 ${address}:address:`,
	"0500": (feedback: string) => $localize`:@@sst.0500:sst.0500 ${feedback}:feedback:`,
	"0501": (feedback: string, filter: number) => $localize`:@@sst.0501:sst.0501 ${feedback}:feedback: ${filter}:filter:`,
	"0501.filter-zero": (feedback: string) =>
		$localize`:@@sst.0501.filter-zero:sst.0501.filter-zero ${feedback}:feedback:`,
	"0502.one": (channel: string, shortest: number, ticks: number) =>
		$localize`:@@sst.0502.one:sst.0502.one ${channel}:channel: ${shortest}:shortest: ${ticks}:ticks:`,
	"0502.other": (channels: string, shortest: number, ticks: number) =>
		$localize`:@@sst.0502.other:sst.0502.other ${channels}:channels: ${shortest}:shortest: ${ticks}:ticks:`,
	"0503": (percent: number) => $localize`:@@sst.0503:sst.0503 ${percent}:percent:`,
	"0504": () => $localize`:@@sst.0504:sst.0504`,
	"0505": (name: string) => $localize`:@@sst.0505:sst.0505 ${name}:name:`,
	"0506": () => $localize`:@@sst.0506:sst.0506`,
	"0507.nothing": () => $localize`:@@sst.0507.nothing:sst.0507.nothing`,
	"0507.blocked": (command: string) => $localize`:@@sst.0507.blocked:sst.0507.blocked ${command}:command:`,
	"0507.note-pieces": (ticks: number) => $localize`:@@sst.0507.note-pieces:sst.0507.note-pieces ${ticks}:ticks:`,
	"0507.tie-pieces": (ticks: number) => $localize`:@@sst.0507.tie-pieces:sst.0507.tie-pieces ${ticks}:ticks:`,
	"0507.note-one-tick": () => $localize`:@@sst.0507.note-one-tick:sst.0507.note-one-tick`,
	"0507.tie-one-tick": () => $localize`:@@sst.0507.tie-one-tick:sst.0507.tie-one-tick`,
	"0508": () => $localize`:@@sst.0508:sst.0508`,
	"0509": (label: number) => $localize`:@@sst.0509:sst.0509 ${label}:label:`,
	"0509.zero": () => $localize`:@@sst.0509.zero:sst.0509.zero`,
	"0510": (first: string, repeat: string) => $localize`:@@sst.0510:sst.0510 ${first}:first: ${repeat}:repeat:`,
	"0511": (command: string, channel: number, first: string) =>
		$localize`:@@sst.0511:sst.0511 ${command}:command: ${channel}:channel: ${first}:first:`,
	"0511.default": (command: string, channel: number) =>
		$localize`:@@sst.0511.default:sst.0511.default ${command}:command: ${channel}:channel:`,
	"0511.toggle": (command: string, channel: number) =>
		$localize`:@@sst.0511.toggle:sst.0511.toggle ${command}:command: ${channel}:channel:`,
	"0511.remote.key-on": (command: string, channel: number, reset: string) =>
		$localize`:@@sst.0511.remote.key-on:sst.0511.remote.key-on ${command}:command: ${channel}:channel: ${reset}:reset:`,
	"0511.remote.timed": (command: string, channel: number, reset: string) =>
		$localize`:@@sst.0511.remote.timed:sst.0511.remote.timed ${command}:command: ${channel}:channel: ${reset}:reset:`,
	"0511.remote.key-off": (command: string, channel: number, reset: string) =>
		$localize`:@@sst.0511.remote.key-off:sst.0511.remote.key-off ${command}:command: ${channel}:channel: ${reset}:reset:`,
	"0511.remote.key-off-rest": (command: string, channel: number, reset: string) =>
		$localize`:@@sst.0511.remote.key-off-rest:sst.0511.remote.key-off-rest ${command}:command: ${channel}:channel: ${reset}:reset:`,
	"0512": (command: string, first: string) => $localize`:@@sst.0512:sst.0512 ${command}:command: ${first}:first:`,
	"0512.default": (command: string) => $localize`:@@sst.0512.default:sst.0512.default ${command}:command:`,
	"0512.toggle": (command: string) => $localize`:@@sst.0512.toggle:sst.0512.toggle ${command}:command:`,
};
