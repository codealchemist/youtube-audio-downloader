# YouTube Audio Downloader

A desktop app for macOS, Windows and Linux that saves the audio of a YouTube
video as mp3. Paste a link or video id and the file is saved, tagged with the
title, artist and cover art, and played in the window.

It's built with [Electron](https://www.electronjs.org) on top of
[youtube-audio-server](https://github.com/codealchemist/youtube-audio-server).

## Requirements

The app bundles ffmpeg. Fetching from YouTube needs two tools installed on the
computer:

- [yt-dlp](https://github.com/yt-dlp/yt-dlp), kept up to date (`yt-dlp -U`),
  because YouTube changes often and old versions stop working.
- [Deno](https://deno.com), which yt-dlp uses to run YouTube's player code.

| System | Install |
| --- | --- |
| macOS | `brew install yt-dlp deno` |
| Windows | `winget install yt-dlp.yt-dlp DenoLand.Deno` |
| Linux | Download `yt-dlp_linux` from the [yt-dlp releases](https://github.com/yt-dlp/yt-dlp/releases) into `~/.local/bin`, then `curl -fsSL https://deno.land/install.sh \| sh` |

The app looks for them on `PATH` and in the usual install folders (Homebrew,
`~/.local/bin`, `~/.deno/bin`, WinGet and Scoop). Set `YTDLP_PATH` or
`FFMPEG_PATH` to use a specific copy. The window shows a warning when one is
missing.

## Development

Node.js 24 or newer.

```
npm ci
npm start
```

| Command | What it does |
| --- | --- |
| `npm run lint` | ESLint ([neostandard](https://github.com/neostandard/neostandard)) |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | End-to-end tests (Playwright driving the app) |
| `npm run test:all` | All of the above |
| `npm run make` | Installers for the current system in `out/make` |

The end-to-end tests use a fake yt-dlp ([test/e2e/fixtures](test/e2e/fixtures))
with the real bundled ffmpeg, so they don't need the network. On Windows the
download tests are skipped, since the fake can't run there.
`YAS_LIVE=1 npm run test:e2e` also downloads a real video with your yt-dlp.

Installers are built per system: run `npm run make` on each one (CI does this
on macOS, Windows and Linux). They are zip on macOS, Squirrel and zip on
Windows, and deb, rpm and zip on Linux.

## Security

- The window runs sandboxed with context isolation and no Node access. The page
  reaches the app only through a small bridge (`src/preload/preload.cjs`), and
  the main process checks that each call comes from the app's own page.
- Input is checked to be a YouTube video before anything runs, and video titles
  are shown as text, never as HTML.
- A Content-Security-Policy blocks inline and remote scripts. Navigation,
  pop-ups, webviews and permission requests are refused.
- Packaged builds turn off Electron features the app doesn't use (running as
  Node, `NODE_OPTIONS`, the inspector) and check the integrity of the app archive.
- Dependency install scripts are limited by npm's `allowScripts` to ffmpeg-static
  and electron-winstaller.

## License

MIT
