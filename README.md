# Solar Soundtrack

A browser-based AddmusicK 1.0.11 music editor. It has live music previewing capabilities thanks to the in-browser SPC engine.

Installing AddmusicK is not needed, nor is a ROM. The tool is a static site and works entirely client-side in any modern-day browser.

<!-- TODO: demo gif goes here -->

**[Try it →](https://ersanio.github.io/solar-soundtrack/)**

## Why this exists

AddmusicK is the custom music tool that SMW Central uses. Porting music with AddmusicK has always
been one of my favourite things to do in this hobby. What was never fun was the loop around it:
to actually _hear_ a port, you had to insert it into the ROM, open an emulator, and go to the level
that plays it. When you change around notes, you have to repeat this process.

So the idea was to make a single tool for *everything* custom music-related. Write it, hear
it, edit it, even export it, without leaving the one window. I hope to make custom music
more accessible to people, this way.

AddmusicK, in my opinion, also has room to grow past SMW: the same engine has potential for other
games, and even for homebrew. A huge library of music is available at [SMW Central](https://www.smwcentral.net/?p=section&s=smwmusic).

## Features

- **An AddmusicK-compatible MML compiler**, ported from C++ to TypeScript. It reads
  these target markers: `#amk 1`, `#amk 2`, `#amk 4`, `#am4`, `#amm`. (`#amk 3` is unsupported, the same as in AddmusicK itself.)
- **SPC700 emulation** using Blargg's `snes_spc` as a WebAssembly module.
- **Compile as you type**, with a **Live** mode that reloads the song at the position it
  was already playing. You can keep editing and the music never stops.
- **Seek, loop and volume**, and per-channel **mute** and **solo** controls.
- **A sample browser** where you can import `.brr` files or whole `.bnk` banks, see what each sample
  costs in ARAM, and mark them as important for use in global songs or sound effects.
- **An ARAM budget** that tells you how your work fits within the ARAM.
- **Error reporting** that mentions the erroneous lines with a proper error message.
- **A hex dump** of the compiled song data, just because.
- **Bring your own main.bin** by uploading your own `main.bin` from your own AddmusicK, or
  use the bundled default one.
- **Export** a finished `.spc`, or the raw song-data `.bin`.
- Your draft and your sample library are kept locally, so closing the tab does not lose
  your work.

## What is not there yet

- The editor is a plain text box. There is **no syntax highlighting** (yet).
- **No playhead highlighting.** Showing which note is playing, in the editor, live, is the
  feature I most want that can help debug music. This will be implemented in the future.

See the [https://github.com/ersanio/solar-soundtrack/issues](GitHub Issues) for a list of
ideas, planned features and known issues.

## Running it locally

The application is written in Angular. The Angular workspace lives in `src/`,
one level down from the repository root.

```bash
cd src
npm install
npm start          # dev server on http://localhost:4200/
```

Node 24 is what CI uses. To run the full test suite:

```bash
npm run check      # typecheck, plus seven byte-level test harnesses
```

## How it works

The premise the whole project rests on is that producing a playable SPC file is mostly
data assembly. The driver, the SPC header and the sample set are all static bytes,
already supplied by AddmusicK. The song data is the only thing that has to be compiled
at runtime.

There are three layers, roughly:

| Path                           | What lives there                                                    |
| ------------------------------ | ------------------------------------------------------------------- |
| `src/src/compilers/addmusick/` | The MML compiler - preprocessor, parser, linker                     |
| `src/src/spc/`                 | SPC assembly, BRR handling, the emulator host and the audio worklet |
| `src/src/app/`                 | The Angular UI                                                      |

On testing: `npm run check` runs byte-level harnesses that pin the compiler's output,
SPC assembly, the full headless MML → SPC → PCM chain, BRR and bank decoding. Separately,
`src/scripts/Compare-Spc.ps1` and `Compare-SongBin.ps1` diff this compiler's output
against a native AddmusicK build, for byte-by-byte comparison.

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
  [https://codeberg.org/Telinc1/smwcentral-spc-player](WebAssembly SPC player) built on
  it, which this project uses.
- **The AddmusicK maintainers** from its changelog: [Kipernal](https://smwc.me/u/9822), [KungFuFurby](https://smwc.me/u/30120), [KevinM](https://smwc.me/u/36308), [Medic](https://smwc.me/u/9157), [HertzDevil](https://smwc.me/u/20031), [Atari 2.0](https://smwc.me/u/35033), [nyanpasu64](https://smwc.me/u/22354), JUMP Team, [SimFan96](https://smwc.me/u/34677), [Anas](https://smwc.me/u/25222), [HuFlungDu](https://smwc.me/u/6666), [lx5](https://smwc.me/u/12344), [Pinci](https://smwc.me/u/17935), [6646](https://smwc.me/u/6646), [Akaginite](https://smwc.me/u/8691), [Aikku](https://smwc.me/u/40371), [Sinc-X](https://smwc.me/u/15846), [Lui](https://smwc.me/u/16989), [Vitor](https://smwc.me/u/8251), [Barrels O' Fun](https://smwc.me/u/24105), [Yoshifanatic](https://smwc.me/u/13743)
- **[blackhole89](https://smwc.me/u/3342)** - [the name. _Solar Soundtrack_ was originally his idea](https://web.archive.org/web/20210403023416/http://twilightro.kafuka.org/~blackhole89/sst.php): a piano-roll
  style editor for the N-SPC engine, which I assume was never finished. The name was too
  good to leave unused, and this project is a different shape to what they had in mind, but
  the credit is theirs.

## License

MIT - see [LICENSE](LICENSE).

The bundled third-party material keeps its own terms. The emulator core is LGPL 2.1, and
the driver bundle under `src/public/driver/` is AddmusicK output whose `#default` samples
originate from Super Mario World; `LICENSE` spells both out.

## Contact

I am **Ersanio** - [GitHub](https://github.com/ersanio) · [SMW Central](https://smwc.me/u/3).

The best way to reach me is a **Discord DM**, I am in the SnesLab and SMW Central Discord
servers. Failing that, a private message on SMW Central works too.

I might also request a project channel on the SnesLab server, if there is enough interest.
