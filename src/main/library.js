// The songs in the download folder. The window refers to a song by its file
// name only; every operation resolves that name inside the current folder
// and refuses anything that isn't an mp3 directly in it.
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseVideoId } from 'youtube-audio-server'
import { readTag } from './id3.js'

export const MESSAGES = {
  NOT_FOUND: 'That song is no longer in the folder.',
  EMPTY_NAME: 'Enter a name for the song.',
  LONG_NAME: 'That name is too long.',
  RESERVED_NAME: 'That name can\'t be used for a file.',
  EXISTS: 'Another song already has that name.',
  RENAME_FAILED: 'The song could not be renamed.',
  DELETE_FAILED: 'The song could not be deleted.'
}

export class LibraryError extends Error {
  constructor (message) {
    super(message)
    this.name = 'LibraryError'
  }
}

const EXTENSION = '.mp3'
// Leaves room for ".mp3" within the 255 bytes most file systems allow.
const MAX_NAME_BYTES = 200
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i
// Control characters, bidi overrides (which can disguise a name), and
// characters that aren't allowed in file names on Windows.
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩<>:"/\\|?*]/g

export function isSongName (name) {
  return typeof name === 'string' &&
    name.length > EXTENSION.length &&
    name.toLowerCase().endsWith(EXTENSION) &&
    !name.startsWith('.') &&
    path.basename(name) === name &&
    path.win32.basename(name) === name &&
    !name.includes('\0')
}

export const songTitle = name => name.slice(0, -EXTENSION.length)

// Turns what the user typed into a file name, or throws a LibraryError.
export function songFileName (title) {
  if (typeof title !== 'string') throw new LibraryError(MESSAGES.EMPTY_NAME)
  let name = title.normalize('NFC').replace(UNSAFE, ' ').replace(/\s+/g, ' ')
  if (name.toLowerCase().endsWith(EXTENSION)) name = songTitle(name)
  name = name.replace(/^[\s.]+|[\s.]+$/g, '')

  if (!name) throw new LibraryError(MESSAGES.EMPTY_NAME)
  if (Buffer.byteLength(name) > MAX_NAME_BYTES) throw new LibraryError(MESSAGES.LONG_NAME)
  if (RESERVED.test(name.split('.')[0])) throw new LibraryError(MESSAGES.RESERVED_NAME)
  return name + EXTENSION
}

// The YouTube page a song came from, rebuilt from the video id in its
// comment tag so arbitrary text is never handed to the clipboard as a link.
export function youtubeLink (comment) {
  const id = parseVideoId(comment)
  return id ? `https://www.youtube.com/watch?v=${id}` : null
}

export function createLibrary ({ getFolder, trashItem, readTags = readTag }) {
  // Tags by file, reused while the file is unchanged.
  const cache = new Map()

  async function resolve (name) {
    if (!isSongName(name)) throw new LibraryError(MESSAGES.NOT_FOUND)
    const file = path.join(getFolder(), name)
    const stat = await fs.stat(file).catch(() => null)
    if (!stat?.isFile()) throw new LibraryError(MESSAGES.NOT_FOUND)
    return { file, stat }
  }

  async function describe (name, file, stat) {
    const key = `${file}:${stat.size}:${stat.mtimeMs}`
    let tags = cache.get(file)
    if (tags?.key !== key) {
      const read = await readTags(file, { cover: false }).catch(() => ({}))
      tags = { key, artist: read.artist || '', album: read.album || '', hasCover: Boolean(read.cover), link: youtubeLink(read.comment) }
      cache.set(file, tags)
    }
    return {
      name,
      title: songTitle(name),
      artist: tags.artist,
      album: tags.album,
      hasCover: tags.hasCover,
      link: tags.link,
      size: stat.size,
      modified: stat.mtimeMs,
      url: pathToFileURL(file).href
    }
  }

  // Newest first.
  async function list () {
    const folder = getFolder()
    const entries = await fs.readdir(folder, { withFileTypes: true }).catch(() => [])
    const songs = []
    for (const entry of entries) {
      if (!entry.isFile() || !isSongName(entry.name)) continue
      const file = path.join(folder, entry.name)
      const stat = await fs.stat(file).catch(() => null)
      if (stat) songs.push(await describe(entry.name, file, stat))
    }
    return songs.sort((a, b) => b.modified - a.modified)
  }

  async function get (name) {
    const { file, stat } = await resolve(name)
    return describe(name, file, stat)
  }

  async function cover (name) {
    const { file } = await resolve(name)
    const tags = await readTags(file).catch(() => null)
    return tags?.cover || null
  }

  // Returns the new file name.
  async function rename (name, title) {
    const { file } = await resolve(name)
    const newName = songFileName(title)
    if (newName === name) return name

    const target = path.join(getFolder(), newName)
    // On case-insensitive disks "song.mp3" exists when renaming it to "Song.mp3".
    const sameFile = newName.toLowerCase() === name.toLowerCase()
    if (!sameFile && await fs.stat(target).catch(() => null)) throw new LibraryError(MESSAGES.EXISTS)
    try {
      await fs.rename(file, target)
    } catch {
      throw new LibraryError(MESSAGES.RENAME_FAILED)
    }
    cache.delete(file)
    return newName
  }

  // Moves the song to the Trash (Recycle Bin), so a mistake can be undone.
  async function remove (name) {
    const { file } = await resolve(name)
    try {
      await trashItem(file)
    } catch {
      throw new LibraryError(MESSAGES.DELETE_FAILED)
    }
    cache.delete(file)
  }

  return { list, get, cover, rename, remove, resolve }
}

// The menu the Share button opens. macOS gets the system share sheet
// (AirDrop, Messages, Mail...); every system can copy the YouTube link and
// show the file, ready to drag into another app.
export function shareMenuTemplate ({ platform, file, link, copyText, showItem }) {
  const template = []
  if (platform === 'darwin') {
    template.push({ role: 'shareMenu', label: 'Share', sharingItem: { filePaths: [file] } }, { type: 'separator' })
  }
  if (link) template.push({ label: 'Copy YouTube link', click: () => copyText(link) })
  template.push({ label: platform === 'darwin' ? 'Show in Finder' : 'Show in folder', click: () => showItem(file) })
  return template
}
