// The folder downloads are saved to, kept in the settings store.
import path from 'node:path'

export const FOLDER_KEY = 'audioFolder'

export function defaultFolder (musicPath) {
  return path.join(musicPath, 'YouTube Audio')
}

// Saved folder, else the one the user picks, else the default. Picking can
// be cancelled, which used to save an empty folder.
export async function resolveFolder ({ store, choose, fallback, override }) {
  if (override) return override

  const saved = store.get(FOLDER_KEY)
  if (typeof saved === 'string' && saved) return saved

  const chosen = await choose()
  const folder = chosen || fallback
  store.set(FOLDER_KEY, folder)
  return folder
}

// Points the downloader at `folder`. youtube-audio-server only logs when it
// can't create a folder (an unplugged drive, no permission) and keeps its old
// one, which is `/` for an app opened from the Finder. So the result is
// checked, and `fallback` is used instead with a warning for the window.
export function applyFolder ({ downloader, folder, fallback }) {
  const target = path.resolve(folder)
  downloader.setFolder(target)
  if (downloader.youtube.audioFolder === target) return { folder: target, warning: null }

  const fallbackTarget = fallback && path.resolve(fallback)
  if (fallbackTarget && fallbackTarget !== target) {
    downloader.setFolder(fallbackTarget)
    if (downloader.youtube.audioFolder === fallbackTarget) {
      return { folder: fallbackTarget, warning: `Couldn't use ${target}, so audio is saved to ${fallbackTarget} instead.` }
    }
  }
  return { folder: downloader.youtube.audioFolder, warning: `Couldn't use ${target}. Choose another folder.` }
}

// Saves the picked folder only if the downloader could use it. Returns the
// apply result, or null when the picker was cancelled.
export async function changeFolder ({ store, choose, apply }) {
  const chosen = await choose()
  if (!chosen) return null
  const result = apply(chosen)
  if (!result.warning) store.set(FOLDER_KEY, result.folder)
  return result
}
