// Finds the external tools youtube-audio-server runs: ffmpeg (bundled with
// the app through ffmpeg-static), yt-dlp and Deno (installed by the user).
// Apps started from the Finder, Start menu or a desktop launcher don't get
// the shell's PATH, so common install folders are added to it.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Each tool, whether downloads need it, and the variable that overrides its path.
const TOOLS = {
  'yt-dlp': { required: true, override: 'YTDLP_PATH' },
  ffmpeg: { required: true, override: 'FFMPEG_PATH' },
  deno: { required: false }
}

const pathApiFor = platform => (platform === 'win32' ? path.win32 : path.posix)

// Windows keeps the variable as `Path`.
const currentPath = env => env.PATH ?? env.Path ?? ''

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
  const { delimiter } = pathApiFor(platform)
  const current = currentPath(env).split(delimiter).filter(Boolean)
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
  const pathApi = pathApiFor(platform)
  const extensions = platform === 'win32'
    ? ['', ...(env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)]
    : ['']

  if (pathApi.isAbsolute(name)) {
    return extensions.map(ext => name + ext).find(isFile) ?? null
  }
  for (const dir of searchPath.split(pathApi.delimiter).filter(Boolean)) {
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
// already set) and extends PATH so yt-dlp and Deno are found.
export function configureTools ({ env = process.env, platform = process.platform, ffmpegPath, home } = {}) {
  // On Windows, writing `PATH` updates the same variable as `Path`.
  env.PATH = augmentedPath({ platform, env, home })
  if (!env.FFMPEG_PATH && ffmpegPath) env.FFMPEG_PATH = unpackedPath(ffmpegPath)
}

// Which tools can be found, so the window can explain what's missing.
export function toolStatus ({ env = process.env, platform = process.platform, isFile } = {}) {
  const searchPath = currentPath(env)
  return Object.fromEntries(Object.entries(TOOLS).map(([name, { override }]) => [
    name,
    findExecutable((override && env[override]) || name, { platform, searchPath, env, isFile })
  ]))
}

export function missingTools (status) {
  const missing = Object.keys(TOOLS).filter(name => !status[name])
  return {
    required: missing.filter(name => TOOLS[name].required),
    optional: missing.filter(name => !TOOLS[name].required)
  }
}
