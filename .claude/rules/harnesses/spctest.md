---
paths:
  - 'scripts/spctest.ts'
---

# `spctest`: what it proves

MML → `.spc`, verifying the assembled file's structure. Stubs `fetch` over the SPC package's assets.
Also pins every address in `assets/driver/manifest.json` against the bytes of the shipped
`main.bin`: nothing derives those at runtime, so this is the only thing standing between a rebuilt
driver and an `.spc` that assembles cleanly against the wrong addresses.
