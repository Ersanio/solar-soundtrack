---
paths:
  - 'scripts/brrtest.ts'
---

# `brrtest`: what it proves

BRR container handling, the decoder and the encoder. Cross-checks `BANK_SLOT_COUNT` against
`@amk/spc`'s own `SAMPLE_BANK_SLOTS`. `encodeBrrWithHeadroom` is held to the three weight sets of
the DSP's Gaussian table that sum past 2048: a full-scale square wraps them as encoded plainly,
not once lowered, and a sample with room is encoded as `encodeBrr` encodes it.
