/** The song a fresh editor opens on. Its own module so a harness can import it without Angular. */
export const SAMPLE_SONG = `#amk 4

#spc
{
    #title  "Level Theme"
    #author "Akito Nakatsuka"
    #game   "Ice Climber (NES)"
    #comment "Demo for Solar Soundtrack"
}

#0 w255 t54
o2

g32. r12 e32. r48 f16 r16 g32. r8^48 > c32 r64 < b32 r64 > c32 r64 < b32 r64 > c32 < r64
g32. r12 e32. r48 f16 r16 g32. r8^48 > c32 r64 < b32 r64 > c32 r64 < b32 r64 > c32 < r64
a32. r12 f32. r48 g16 r16 a32. r8^48 > d32 r64 c+32 r64 d32 r64 c+32 r64 d32 < r64
a32. r12 f32. r48 g16 r16 a32. r8^48 > d32 r64 c+32 r64 d32 r64 c+32 r64 d32 < r64

b32. r12 g32. r48 a16 r16 b32. r8^48 > f32 r64 e32 r64 f32 r64 e32 r64 f32 < r64
b32. r12 g32. r48 a16 r16 b32. r8^48 > f32 r64 e32 r64 f32 r64 e32 r64 f32 r64

e16 c16 < g16 > e16 c16 < g16 > f16 d16 < a16 > f16 d16 < a16 >
f+16 d16 c16 f+16 d16 c16 g16 f16 d16 < b16 a+16 a16
`;
