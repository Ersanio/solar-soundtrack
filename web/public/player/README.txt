SPC700 emulator core — vendored, unmodified.

  spc.wasm    from @smwcentral/spc-player 2.0.2
  LICENSE     GNU LGPL 2.1

Upstream: https://codeberg.org/Telinc1/smwcentral-spc-player
Built on Blargg's snes_spc; maintained by Telinc1 for SMW Central.

Only the binary is vendored. Its JavaScript is ours: the upstream bundle is
half emulator and half playlist widget, and the widget half had to be kept
alive with hidden markup and a global `Module` just to reach the emulator. The
wasm needs none of that — it imports eight functions, exports ten, and touches
no DOM. See src/spc/wasm-host.ts for the host and the name mapping, and
src/spc/worklet.ts for the renderer that drives it on the audio thread.

spc-worklet.js is generated here by `npm run build:worklet` (which `npm start`
and `npm run build` run for you) and is not checked in.

To update the core: npm install @smwcentral/spc-player@latest, then copy
node_modules/@smwcentral/spc-player/dist/spc.wasm and LICENSE here. Export and
import names are minified and pinned to this build, so re-read them out of the
new dist/spc.js and update src/spc/wasm-host.ts to match — it throws on an
unexpected export rather than mis-calling one.
