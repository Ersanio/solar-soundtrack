SPC700 emulator core — vendored, unmodified.

  spc.js, spc.wasm          from @smwcentral/spc-player 2.0.2
  spc_player.html           its playlist UI markup
  LICENSE                   GNU LGPL 2.1

Upstream: https://codeberg.org/Telinc1/smwcentral-spc-player
Built on Blargg's snes_spc; maintained by Telinc1 for SMW Central.

Only SMWCentral.SPCPlayer.Backend is driven (see src/spc/player.ts). The bundle
also contains a playlist UI that initialises itself on load and dereferences the
markup in spc_player.html; that markup is injected hidden so the script does not
throw, but its controls are never shown or used.

To update: npm install @smwcentral/spc-player@latest, then copy
node_modules/@smwcentral/spc-player/dist/{spc.js,spc.wasm,spc_player.html} and
LICENSE here.
