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

export async function changeFolder ({ store, choose }) {
  const chosen = await choose()
  if (!chosen) return null
  store.set(FOLDER_KEY, chosen)
  return chosen
}
