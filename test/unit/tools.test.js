import { describe, expect, it } from 'vitest'
import {
  augmentedPath,
  configureTools,
  extraPathDirs,
  findExecutable,
  missingTools,
  toolStatus,
  unpackedPath
} from '../../src/main/tools.js'

describe('extraPathDirs', () => {
  it('adds Homebrew on macOS', () => {
    expect(extraPathDirs({ platform: 'darwin', home: '/Users/me' })).toEqual([
      '/opt/homebrew/bin',
      '/Users/me/.local/bin',
      '/Users/me/.deno/bin',
      '/usr/local/bin'
    ])
  })

  it('adds snap on Linux', () => {
    expect(extraPathDirs({ platform: 'linux', home: '/home/me' })).toContain('/snap/bin')
  })

  it('uses WinGet, Scoop and Deno folders on Windows', () => {
    const dirs = extraPathDirs({ platform: 'win32', home: 'C:\\Users\\me', env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' } })
    expect(dirs).toEqual([
      'C:\\Users\\me\\AppData\\Local\\Microsoft\\WinGet\\Links',
      'C:\\Users\\me\\scoop\\shims',
      'C:\\Users\\me\\.deno\\bin'
    ])
  })
})

describe('augmentedPath', () => {
  it('keeps the current PATH first and skips duplicates', () => {
    const result = augmentedPath({ platform: 'darwin', home: '/Users/me', env: { PATH: '/usr/local/bin:/usr/bin' } })
    expect(result.split(':')).toEqual([
      '/usr/local/bin',
      '/usr/bin',
      '/opt/homebrew/bin',
      '/Users/me/.local/bin',
      '/Users/me/.deno/bin'
    ])
  })

  it('reads Path on Windows and joins with semicolons', () => {
    const result = augmentedPath({ platform: 'win32', home: 'C:\\Users\\me', env: { Path: 'C:\\Windows' } })
    expect(result.startsWith('C:\\Windows;')).toBe(true)
  })

  it('works without any PATH', () => {
    expect(augmentedPath({ platform: 'linux', home: '/home/me', env: {} })).toBe('/home/me/.local/bin:/home/me/.deno/bin:/usr/local/bin:/snap/bin')
  })
})

describe('unpackedPath', () => {
  it('points into app.asar.unpacked', () => {
    expect(unpackedPath('/App/Resources/app.asar/node_modules/ffmpeg-static/ffmpeg'))
      .toBe('/App/Resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg')
    expect(unpackedPath('C:\\App\\resources\\app.asar\\node_modules\\ffmpeg-static\\ffmpeg.exe'))
      .toBe('C:\\App\\resources\\app.asar.unpacked\\node_modules\\ffmpeg-static\\ffmpeg.exe')
  })

  it('leaves development paths alone', () => {
    expect(unpackedPath('/dev/app/node_modules/ffmpeg-static/ffmpeg')).toBe('/dev/app/node_modules/ffmpeg-static/ffmpeg')
    expect(unpackedPath(null)).toBe(undefined)
  })
})

describe('findExecutable', () => {
  const files = new Set(['/opt/homebrew/bin/yt-dlp', 'C:\\Tools\\yt-dlp.EXE', '/abs/ffmpeg'])
  const isFile = file => files.has(file)

  it('searches PATH in order', () => {
    expect(findExecutable('yt-dlp', { platform: 'darwin', searchPath: '/usr/bin:/opt/homebrew/bin', isFile })).toBe('/opt/homebrew/bin/yt-dlp')
  })

  it('tries PATHEXT extensions on Windows', () => {
    expect(findExecutable('yt-dlp', { platform: 'win32', searchPath: 'C:\\Windows;C:\\Tools', env: { PATHEXT: '.COM;.EXE' }, isFile })).toBe('C:\\Tools\\yt-dlp.EXE')
  })

  it('accepts absolute paths', () => {
    expect(findExecutable('/abs/ffmpeg', { platform: 'linux', isFile })).toBe('/abs/ffmpeg')
    expect(findExecutable('/abs/missing', { platform: 'linux', isFile })).toBe(null)
  })

  it('returns null when missing', () => {
    expect(findExecutable('deno', { platform: 'linux', searchPath: '/usr/bin', isFile })).toBe(null)
  })
})

describe('configureTools', () => {
  it('sets the bundled ffmpeg and extends PATH', () => {
    const env = { PATH: '/usr/bin' }
    configureTools({ env, platform: 'linux', home: '/home/me', ffmpegPath: '/r/app.asar/node_modules/ffmpeg-static/ffmpeg' })
    expect(env.FFMPEG_PATH).toBe('/r/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg')
    expect(env.PATH.startsWith('/usr/bin:')).toBe(true)
  })

  it('keeps an FFMPEG_PATH the user set', () => {
    const env = { PATH: '', FFMPEG_PATH: '/custom/ffmpeg' }
    configureTools({ env, platform: 'linux', home: '/h', ffmpegPath: '/bundled/ffmpeg' })
    expect(env.FFMPEG_PATH).toBe('/custom/ffmpeg')
  })
})

describe('toolStatus and missingTools', () => {
  it('reports what is missing', () => {
    const files = new Set(['/bin/yt-dlp', '/custom/ffmpeg'])
    const status = toolStatus({ platform: 'linux', env: { PATH: '/bin', FFMPEG_PATH: '/custom/ffmpeg' }, isFile: f => files.has(f) })
    expect(status).toEqual({ 'yt-dlp': '/bin/yt-dlp', ffmpeg: '/custom/ffmpeg', deno: null })
    expect(missingTools(status)).toEqual({ required: [], optional: ['deno'] })
  })

  it('honours YTDLP_PATH', () => {
    const status = toolStatus({ platform: 'linux', env: { PATH: '', YTDLP_PATH: '/x/yt' }, isFile: f => f === '/x/yt' })
    expect(status['yt-dlp']).toBe('/x/yt')
    expect(missingTools(status).required).toEqual(['ffmpeg'])
  })
})
