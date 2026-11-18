# Decisions already made: `.claude/rules/problems.md`

The ledger of `.claude/rules/problems.md`: each entry is a design that was built or considered there
and moved away from, with the reason. The rule carries one index line per entry.

- **Building a fix only while the compile has caught up with the document** — a compiler
  diagnostic's span indexes `compiledText`, which is one edit behind the document for the 150 ms of
  the typing debounce, so building its fix only while the two agree is the obvious guard. That
  takes every Fix button on a compiler diagnostic out on each keystroke and puts it back after the
  debounce, reflowing the message beside it while the porter types. The fix is built against the compiled
  text and its own scan instead (`FixContext.compiled`, `EditorStore.compiledTokens`), as the
  diagnostic it answers was, and carries that text as `Fix.against`; `openFix` forces the compile
  and rebuilds one whose text has moved on, and `apply` refuses one that still has.
- **Cutting a `#spc` value that holds `\"` by the length the parser reads** — `getQuotedString`
  reads `\"` as one character, so counting the value that way and cutting at 32 is what the tag
  holds. But `preprocess` reads every `"` as a delimiter (`preprocess.ts:145`, globals.cpp:735), so
  a value compiles only with its `\"`s paired, and a cut keeping an odd number of them leaves a
  string AddmusicK never closes (AMK0400). A value holding one is not cut at all.
