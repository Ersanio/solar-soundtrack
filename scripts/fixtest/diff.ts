/** `fixtest`: the diff the fix dialog draws — kinds, line numbers, context and what is folded away. */

import type { Edit } from "@amk/tokens/edits";
import {
	CONTEXT_LINES,
	type DiffRow,
	diffRows,
	inlineParts,
} from "../../web/src/app/output/diagnostics-list/fixes/fix-diff";
import { check, section } from "../harness";

function edit(source: string, start: number, end: number, text: string): Edit {
	return { span: { start, end, line: 0 }, text, expect: source.slice(start, end) };
}

/** One letter per row (c context, r removed, a added, m changed, s skipped), for comparing at a glance. */
function shape(rows: readonly DiffRow[]): string {
	return rows.map((row) => ({ context: "c", removed: "r", added: "a", changed: "m", skipped: "s" })[row.kind]).join("");
}

const LINES = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`);
const TEXT = LINES.join("\n");
const at = (line: number) => TEXT.indexOf(`line ${line}`);

section("a line removed whole is one removed row, with context either side and the rest folded");
{
	const start = at(6);
	const rows = diffRows(TEXT, [edit(TEXT, start, at(7), "")]);
	check("removed: shape", shape(rows) === "sccrcccs", shape(rows));
	check("removed: the old line number", rows[3]?.kind === "removed" && rows[3].old === 6);
	check(
		"removed: folds what is outside the context",
		rows[0]?.kind === "skipped" && rows[0].count === 6 - CONTEXT_LINES - 1,
	);
	const after = rows[4];
	check(
		"removed: lines after it are numbered one less on the new side",
		after?.kind === "context" && after.old === 7 && after.new === 6,
	);
}

section("a line written whole is one added row");
{
	const rows = diffRows(TEXT, [edit(TEXT, at(1), at(1), "#amk 4\n")]);
	check("added: shape", shape(rows) === "acccs", shape(rows));
	check("added: its new line number", rows[0]?.kind === "added" && rows[0].new === 1);
}

section("a line changed inside is one changed row, its parts what stayed, went and came");
{
	const text = "#0 @0 o4 C4 D4 e4";
	const rows = diffRows(text, [edit(text, 9, 10, "c"), edit(text, 12, 13, "d")]);
	check("changed: shape", shape(rows) === "m", shape(rows));
	const parts = rows[0]?.kind === "changed" ? rows[0].parts : [];
	const said = parts.map((part) => `${part.kind[0]}:${part.text}`).join("|");
	check("changed: parts", said === "s:#0 @0 o4 |r:C|a:c|s:4 |r:D|a:d|s:4 e4", said);
}

section("an edit that ends a line and starts one leaves the first as context");
{
	const text = "#0 c4\n#1 c4";
	const rows = diffRows(text, [edit(text, text.length, text.length, "\nr2")]);
	check("appended: shape", shape(rows) === "cca", shape(rows));
}

section("changes close together share their context; CRLF is not part of a line");
{
	const text = LINES.join("\r\n");
	const first = text.indexOf("line 3");
	const second = text.indexOf("line 5");
	const rows = diffRows(text, [edit(text, first, first + 1, "L"), edit(text, second, second + 1, "L")]);
	check("together: shape", shape(rows) === "ccmcmccs", shape(rows));
	check(
		"together: no carriage return",
		rows.every((row) => row.kind !== "context" || !row.text.includes("\r")),
	);
}

section("a text ending in a line break draws no empty line after its last");
{
	const text = "#amk 2\n#louder\n#0 c4\n";
	const rows = diffRows(text, [edit(text, 7, 15, "")]);
	check("trailing line break: shape", shape(rows) === "crc", shape(rows));
}

section("a long line falls back to its common ends");
{
	const before = "x".repeat(300);
	const after = `${"x".repeat(150)}y${"x".repeat(149)}`;
	const parts = inlineParts(before, after);
	check("long line: three runs", parts.map((part) => part.kind).join(",") === "same,removed,added,same");
}
