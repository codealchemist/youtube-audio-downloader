// The folder downloads are saved to, kept in the settings store.
import fs from 'node:fs'
import path from 'node:path'

export const FOLDER_KEY = 'audioFolder'

export function defaultFolder (musicPath) {
  return path.join(musicPath, 'YouTube Audio')
}

function createFolder (folder) {
  try {
    fs.mkdirSync(folder, { recursive: true })
    return true
  } catch {
    return false
  }
}

// Points the downloader at `folder`. youtube-audio-server only logs when it
// can't create a folder (an unplugged drive, no permission) and keeps its old
// one, which is `/` for an app opened from the Finder. So the folder is
// created here first, and `fallback` is used instead with a warning for the
// window when that fails. `ok` says whether `folder` itself is in use.
export function applyFolder ({ downloader, folder, fallback, create = createFolder }) {
  const target = path.resolve(folder)
  if (create(target)) {
    downloader.setFolder(target)
    return { ok: true, folder: target, warning: null }
  }

  const fallbackTarget = fallback && path.resolve(fallback)
  if (fallbackTarget && fallbackTarget !== target && create(fallbackTarget)) {
    downloader.setFolder(fallbackTarget)
    return { ok: false, folder: fallbackTarget, warning: `Couldn't use ${target}, so audio is saved to ${fallbackTarget} instead.` }
  }
  return { ok: false, folder: downloader.youtube.audioFolder, warning: `Couldn't use ${target}. Choose another folder.` }
}

// Picked folders are saved only if the downloader could use them.
function save (store, result) {
  if (result.ok) store.set(FOLDER_KEY, result.folder)
  return result
}

// Applies the saved folder, else the one the user picks, else the default.
// Picking can be cancelled, which used to save an empty folder.
export async function resolveFolder ({ store, choose, apply, fallback, override }) {
  if (override) return apply(override)

  const saved = store.get(FOLDER_KEY)
  if (saved) return apply(saved)

  return save(store, apply((await choose()) || fallback))
}

// Returns the apply result, or null when the picker was cancelled.
export async function changeFolder ({ store, choose, apply }) {
  const chosen = await choose()
  if (!chosen) return null
  return save(store, apply(chosen))
}
