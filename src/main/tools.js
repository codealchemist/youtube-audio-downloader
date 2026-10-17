// Finds the external tools youtube-audio-server runs: ffmpeg (bundled with
// the app through ffmpeg-static), yt-dlp and Deno (installed by the user).
// Apps started from the Finder, Start menu or a desktop launcher don't get
// the shell's PATH, so common install folders are added to it.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const REQUIRED_TOOLS = ['yt-dlp', 'ffmpeg']
export const OPTIONAL_TOOLS = ['deno']

export function extraPathDirs ({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local')
    return [
      path.win32.join(localAppData, 'Microsoft', 'WinGet', 'Links'),
      path.win32.join(home, 'scoop', 'shims'),
      path.win32.join(home, '.deno', 'bin')
    ]
  }

  const dirs = [
    path.posix.join(home, '.local', 'bin'),
    path.posix.join(home, '.deno', 'bin'),
    '/usr/local/bin'
  ]
  if (platform === 'darwin') dirs.unshift('/opt/homebrew/bin')
  if (platform === 'linux') dirs.push('/snap/bin')
  return dirs
}

// PATH with the extra folders appended, without duplicates.
export function augmentedPath ({ platform = process.platform, env = process.env, home } = {}) {
  const delimiter = platform === 'win32' ? ';' : ':'
  const current = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)
  const dirs = [...current]
  for (const dir of extraPathDirs({ platform, env, home })) {
    if (!dirs.includes(dir)) dirs.push(dir)
  }
  return dirs.join(delimiter)
}

// Inside a packaged app ffmpeg-static points into app.asar, but executables
// can only run from the unpacked copy next to it.
export function unpackedPath (file) {
  return file?.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
}

// Returns the full path of `name` in `searchPath`, or null.
export function findExecutable (name, { platform = process.platform, searchPath = '', env = process.env, isFile = defaultIsFile } = {}) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  const delimiter = platform === 'win32' ? ';' : ':'
  const extensions = platform === 'win32'
    ? ['', ...(env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)]
    : ['']

  if (pathApi.isAbsolute(name)) {
    return extensions.map(ext => name + ext).find(isFile) ?? null
  }
  for (const dir of searchPath.split(delimiter).filter(Boolean)) {
    for (const ext of extensions) {
      const candidate = pathApi.join(dir, name + ext)
      if (isFile(candidate)) return candidate
    }
  }
  return null
}

function defaultIsFile (file) {
  try {
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

// Points youtube-audio-server at the bundled ffmpeg (unless FFMPEG_PATH is
// already set) and extends PATH so yt-dlp and Deno are found. Returns the
// environment changes, which `env` receives.
export function configureTools ({ env = process.env, platform = process.platform, ffmpegPath, home } = {}) {
  const changes = { PATH: augmentedPath({ platform, env, home }) }
  if (!env.FFMPEG_PATH && ffmpegPath) changes.FFMPEG_PATH = unpackedPath(ffmpegPath)
  // Windows keeps the variable as `Path`; writing `PATH` updates the same one.
  Object.assign(env, changes)
  return changes
}

// Which tools can be found, so the window can explain what's missing.
export function toolStatus ({ env = process.env, platform = process.platform, isFile } = {}) {
  const searchPath = env.PATH ?? env.Path ?? ''
  const locate = (name, override) => findExecutable(override || name, { platform, searchPath, env, isFile })
  return {
    'yt-dlp': locate('yt-dlp', env.YTDLP_PATH),
    ffmpeg: locate('ffmpeg', env.FFMPEG_PATH),
    deno: locate('deno')
  }
}

export function missingTools (status) {
  return {
    required: REQUIRED_TOOLS.filter(name => !status[name]),
    optional: OPTIONAL_TOOLS.filter(name => !status[name])
  }
}
