# YouTube Audio Downloader

A desktop app for macOS, Windows and Linux that saves the audio of YouTube
videos as mp3 and plays them.

- **Download queue.** Paste one link or many (one per line, or separated by
  spaces or commas). They download one after another, each showing whether
  it's waiting, downloading (with progress), saved or failed. Failed downloads
  can be retried.
- **Library.** Every mp3 in the download folder is listed with its cover,
  artist, size and date, newest first or by name, with search.
- **Player.** Play, pause, previous, next, seek and volume, with the song's
  cover in the player and blurred behind the window. Space plays and pauses,
  and media keys work.
- **Rename, delete and share.** Rename a song's file in place, move it to the
  Trash (Recycle Bin), or share it: on macOS through the system share sheet
  (AirDrop, Messages, Mail...), and everywhere by copying its YouTube link or
  showing the file in its folder.

Songs are saved tagged with the title, artist and cover art. The cover shown
in the app is read from those tags, so songs downloaded by older versions or
other apps show theirs too.

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
  and file names are shown as text, never as HTML.
- The page refers to songs by file name only. The main process resolves each
  name inside the download folder and refuses anything else, new names are
  cleaned of path separators and reserved characters, and deleting asks first
  and moves the file to the Trash. Covers reach the page as image data (JPEG or
  PNG only), never as file paths.
- A Content-Security-Policy blocks inline and remote scripts. Navigation,
  pop-ups, webviews and permission requests are refused.
- Packaged builds turn off Electron features the app doesn't use (running as
  Node, `NODE_OPTIONS`, the inspector) and check the integrity of the app archive.
- Dependency install scripts are limited by npm's `allowScripts` to ffmpeg-static
  and electron-winstaller.

## License

MIT
