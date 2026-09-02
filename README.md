# Solar Soundtrack

A browser-based AddmusicK 1.0.11 music editor. It has live music previewing capabilities thanks to the in-browser SPC engine.

Installing AddmusicK is not needed, nor is a ROM. The tool is a static site and works entirely client-side in any modern-day browser.

<!-- TODO: demo gif goes here -->

**[Try it →](https://ersanio.github.io/solar-soundtrack/)** ·
**[Porter's manual →](README.html)** — what it does, and every control in it.

## Why this exists

AddmusicK is the custom music tool that SMW Central uses. Porting music with Addmusic has always
been one of my favourite things to do in this hobby. What was never fun was the loop around it:
to actually _hear_ a port, you had to insert it into the ROM, open an emulator, and go to the level
that plays it. When you change around notes, you have to repeat this process. Nowadays, AddmusicK
has a "porter mode" that makes this process easier, but still requires switching windows.

So the idea was to make a single tool for _everything_ custom music-related. Write it, hear
it, edit it, even export it, without leaving this one window. I hope to make custom music
more accessible to people, this way.

AddmusicK, in my opinion, also has room to grow past SMW: the same engine has potential for other
games, and even for homebrew. A huge library of music is available at [SMW Central](https://www.smwcentral.net/?p=section&s=smwmusic).

## Features

- **An AddmusicK-compatible MML compiler**, ported from C++ to TypeScript. It reads
  these target markers: `#amk 1`, `#amk 2`, `#amk 4`, `#am4`, `#amm`. (`#amk 3` is unsupported, the same as in AddmusicK itself.)
- **SPC700 emulation** using Blargg's `snes_spc` as a WebAssembly module.
- **Compile as you type**, with a **Hot Reload** mode that reloads the song at the position it
  was already playing. You can keep editing and the music never stops.
- **Seek, loop and volume**, and per-channel **mute** and **solo** controls.
- **A layout in FL Studio's mould** — transport and ARAM meter in the top bar, an inspector-first
  sidebar, a status bar, and a tablet drawer; the theme picker recolours any of it.
- **A sample browser** where you can import `.brr` files or whole `.bnk` banks, see what each sample
  costs in ARAM, and mark them as important for use in global songs or sound effects.
- **An ARAM budget** that tells you how your work fits within the ARAM.
- **Error reporting** that mentions the erroneous lines with a proper error message.
- **A command inspector** that explains whatever the cursor is sitting on: `t54` as a tempo in BPM,
  `@2` as the sample it actually plays, `$F1` as a delay in milliseconds and a buffer size in KiB,
  and any other hex command as its name with its arguments decoded.
- **An echo FIR filter designer.** The eight coefficients of `$F5` are the least readable thing in
  the language, so put the cursor on one and you get a frequency-response plot, named presets
  (including Super Mario World's own filter, verbatim), a dark-to-bright tone control, and
  FIRcon-style draw-a-curve-and-fit. It plots the echo tail repeat by repeat, since the filter is
  inside the feedback loop and each pass is filtered again; it shades the region below ~2 kHz where
  eight taps at 32 kHz have no real say; and it warns when the feedback and the filter together
  make an echo that builds up instead of dying away. Edits go straight back into the MML, so with
  **Hot Reload** on you hear the change on the running song.
- **Syntax highlighting**, and a **live playhead** that follows the driver rather than estimating —
  so the highlighted note is the note you are hearing, in every channel.
- **A hex dump** of the compiled song data, just because.
- **Export** a finished `.spc`, or the raw song-data `.bin`.
- Your draft and your sample library are kept locally, so closing the tab does not lose
  your work.
- **A changelog** in the top bar, listing what each day of work added. It is a plain hand-edited
  list in `web/src/app/changelog/changelog-data.ts` — add a block at the top when you add a feature.

See the [GitHub Issues](https://github.com/ersanio/solar-soundtrack/issues) for a list of
ideas, planned features and known issues.

## Running it locally

An npm workspace: four framework-free packages and the Angular editor that imports them. Every
command runs from the repository root.

```bash
npm install
npm start          # dev server on http://localhost:4200/
```

Node 24 is what CI uses.

### npm scripts

| Command          | What it does                                                      |
| ---------------- | ----------------------------------------------------------------- |
| `npm start`      | Dev server on `http://localhost:4200/`.                           |
| `npm run build`  | Production build, output in `web/dist/`.                          |
| `npm run watch`  | Dev-configuration build with `--watch`, no server.                |
| `npm run lint`   | ESLint over every workspace.                                      |
| `npm run format` | Prettier over the workspace.                                      |
| `npm run check`  | The merge gate: formatting, three typechecks, fourteen harnesses. |

`npm run check` is what CI runs. The fourteen harnesses pin the compiler, the scanner, SPC assembly,
the headless MML → SPC → PCM chain, the worklet, BRR decoding, the echo FIR and the envelope maths
against known-good byte output. `scripts/README.md` says what each one actually proves.

Three things run automatically before the commands above (via `pre*` npm hooks), so you never need
to invoke them yourself: the audio worklet is bundled with esbuild, the SPC package's driver and
emulator assets are mirrored into `web/public/`, and the current commit SHA is written to a
gitignored file that powers the top bar's commit link. The SHA is captured once when the dev server
starts, so it goes stale if you commit while `npm start` keeps running — restart to refresh it.

## How it works

The premise the whole project rests on is that producing a playable SPC file is mostly
data assembly. The driver, the SPC header and the sample set are all static bytes,
already supplied by AddmusicK. The song data is the only thing that has to be compiled
at runtime.

Four packages, and an editor that imports them. Each has a `README.md` of its own.

| Path                     | What lives there                                                   |
| ------------------------ | ------------------------------------------------------------------ |
| `packages/core/`         | Types, AddmusicK's constant tables, hex formatting                 |
| `packages/mml-compiler/` | The MML compiler — preprocessor, parser, linker                    |
| `packages/mml-tokens/`   | The scanner behind highlighting and the command inspector          |
| `packages/spc/`          | SPC assembly, BRR, the echo FIR, the emulator host and the worklet |
| `web/`                   | The Angular editor                                                 |

Nothing in `packages/` touches a framework or the DOM beyond three `fetch` calls, which is what lets
the same modules run in Node under the test harnesses, on the main thread, and inside an audio
worklet.

On testing: `npm run check` runs fourteen byte-level harnesses — see `scripts/README.md`. Separately,
`scripts/Compare-Spc.ps1` and `Compare-SongBin.ps1` diff this compiler's output against a native
AddmusicK build, byte for byte.

## Contributing

Contributions are very welcome, but **please read this part first**, because I would rather
be honest than get you halfway into a pull request before you find out.

**Effectively all of the code in this repository was written by AI.** It works, it is
tested, and I have read and steered it to the best of my abilities, but it has not had the kind of human
touch that a codebase deserves before people build on it. Expect inconsistencies, over-engineering in some
places and cut corners in others, and expect to spend longer than usual working out _why_ something is
the way it is.

For now, I'd rather you test the application functionally, and report bugs, submit ideas or feature requests,
than try to contribute code, until the codebase is more... maintainable. I will be working on that, but it is a
slow process.

Practical bits: `npm run check` should pass before you open a PR. If you are planning
something large, please talk to me first, partly so we do not duplicate work, and partly
because there are certain directions I want to take the project to.

## Credits

This project stands on other people's work:

- **Blargg** - `snes_spc`, the SPC700 emulator core that makes any of this audible.
- **Telinc1 and SMW Central** - the
  [WebAssembly SPC player](https://codeberg.org/Telinc1/smwcentral-spc-player) built on
  it, which this project uses.
- **The AddmusicK maintainers** from its changelog: [Kipernal](https://smwc.me/u/9822), [KungFuFurby](https://smwc.me/u/30120), [KevinM](https://smwc.me/u/36308), [Medic](https://smwc.me/u/9157), [HertzDevil](https://smwc.me/u/20031), [Atari 2.0](https://smwc.me/u/35033), [nyanpasu64](https://smwc.me/u/22354), JUMP Team, [SimFan96](https://smwc.me/u/34677), [Anas](https://smwc.me/u/25222), [HuFlungDu](https://smwc.me/u/6666), [lx5](https://smwc.me/u/12344), [Pinci](https://smwc.me/u/17935), [6646](https://smwc.me/u/6646), [Akaginite](https://smwc.me/u/8691), [Aikku](https://smwc.me/u/40371), [Sinc-X](https://smwc.me/u/15846), [Lui](https://smwc.me/u/16989), [Vitor](https://smwc.me/u/8251), [Barrels O' Fun](https://smwc.me/u/24105), [Yoshifanatic](https://smwc.me/u/13743)
- **[blackhole89](https://smwc.me/u/3342)** - [the name. _Solar Soundtrack_ was originally their idea](https://web.archive.org/web/20210403023416/http://twilightro.kafuka.org/~blackhole89/sst.php): a piano-roll
  style editor for the N-SPC engine, which I assume was never finished. The name was too
  good to leave unused, and this project is a different shape to what they had in mind, but
  the credit is theirs.

## License

MIT - see [LICENSE](LICENSE).

The bundled third-party material keeps its own terms. The emulator core is LGPL 2.1, and
the driver bundle under `packages/spc/assets/driver/` is AddmusicK output whose `#default` samples
originate from Super Mario World; `LICENSE` spells both out.

## Contact

I am **Ersanio** - [GitHub](https://github.com/ersanio) · [SMW Central](https://smwc.me/u/3).

The best way to reach me is a **Discord DM**, I am in the SnesLab and SMW Central Discord
servers. Failing that, a private message on SMW Central works too.

I might also request a project channel on the SnesLab server, if there is enough interest.
