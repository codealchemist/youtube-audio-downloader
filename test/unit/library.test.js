import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MESSAGES, createLibrary, isSongName, shareMenuTemplate, songFileName, youtubeLink } from '../../src/main/library.js'
import { makeSong } from '../helpers/make-song.js'

const LINK = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'

describe('isSongName', () => {
  it.each(['Song.mp3', 'A b (c) [d].MP3', 'Ünïcode ♫.mp3'])('accepts %j', name => {
    expect(isSongName(name)).toBe(true)
  })

  it.each([
    '', '.mp3', 'Song.wav', '.hidden.mp3', '../Song.mp3', 'dir/Song.mp3', 'dir\\Song.mp3',
    '/etc/Song.mp3', 'C:\\Song.mp3', 'a\0.mp3', null, 42, { name: 'Song.mp3' }
  ])('refuses %j', name => {
    expect(isSongName(name)).toBe(false)
  })
})

describe('songFileName', () => {
  it.each([
    ['My Song', 'My Song.mp3'],
    ['  spaced   out  ', 'spaced out.mp3'],
    ['typed.mp3', 'typed.mp3'],
    ['a/b\\c:d*e?f"g<h>i|j', 'a b c d e f g h i j.mp3'],
    ['..hidden..', 'hidden.mp3'],
    ['bidi\u202eevil\u0007', 'bidi evil.mp3'],
    ['Cafe\u0301', 'Café.mp3']
  ])('%j becomes %j', (title, name) => {
    expect(songFileName(title)).toBe(name)
  })

  it.each([
    ['', MESSAGES.EMPTY_NAME],
    ['  ...  ', MESSAGES.EMPTY_NAME],
    [null, MESSAGES.EMPTY_NAME],
    ['x'.repeat(201), MESSAGES.LONG_NAME],
    ['CON', MESSAGES.RESERVED_NAME],
    ['lpt1.txt', MESSAGES.RESERVED_NAME]
  ])('refuses %j', (title, message) => {
    expect(() => songFileName(title)).toThrow(message)
  })
})

describe('youtubeLink', () => {
  it('rebuilds the link from the video id', () => {
    expect(youtubeLink('https://youtu.be/dQw4w9WgXcQ')).toBe(LINK)
    expect(youtubeLink('dQw4w9WgXcQ')).toBe(LINK)
  })

  it('ignores anything else', () => {
    expect(youtubeLink('javascript:alert(1)')).toBeNull()
    expect(youtubeLink('https://evil.example/watch?v=dQw4w9WgXcQ')).toBeNull()
    expect(youtubeLink('')).toBeNull()
    expect(youtubeLink(undefined)).toBeNull()
  })
})

describe('createLibrary', () => {
  let dir
  let trashItem
  let library

  const touch = (name, secondsAgo) => {
    const time = Date.now() / 1000 - secondsAgo
    fs.utimesSync(path.join(dir, name), time, time)
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yas-library-'))
    trashItem = vi.fn(async file => fs.rmSync(file))
    library = createLibrary({ getFolder: () => dir, trashItem })
  })

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('lists mp3s in the folder, newest first, with their tags', async () => {
    makeSong(dir, { title: 'Old', artist: 'Band', album: 'LP', comment: LINK, cover: true })
    makeSong(dir, { title: 'New' })
    touch('Old.mp3', 100)
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'x')
    fs.writeFileSync(path.join(dir, '.Song.mp3.1234.part'), 'x')
    fs.mkdirSync(path.join(dir, 'Folder.mp3'))

    const songs = await library.list()
    expect(songs.map(song => song.name)).toEqual(['New.mp3', 'Old.mp3'])
    expect(songs[1]).toMatchObject({
      title: 'Old',
      artist: 'Band',
      album: 'LP',
      hasCover: true,
      link: LINK,
      url: pathToFileURL(path.join(dir, 'Old.mp3')).href
    })
    expect(songs[1].size).toBeGreaterThan(0)
    expect(songs[0]).toMatchObject({ title: 'New', artist: '', hasCover: false, link: null })
  })

  it('reads tags again only when a file changes', async () => {
    const readTags = vi.fn(async () => ({ artist: 'A' }))
    library = createLibrary({ getFolder: () => dir, trashItem, readTags })
    makeSong(dir, { title: 'Song' })
    await library.list()
    await library.list()
    expect(readTags).toHaveBeenCalledTimes(1)

    touch('Song.mp3', 50)
    await library.list()
    expect(readTags).toHaveBeenCalledTimes(2)
  })

  it('lists songs with unreadable tags, and an empty list for a missing folder', async () => {
    library = createLibrary({ getFolder: () => dir, trashItem, readTags: async () => { throw new Error('bad') } })
    makeSong(dir, { title: 'Song' })
    expect((await library.list())[0]).toMatchObject({ name: 'Song.mp3', artist: '' })

    library = createLibrary({ getFolder: () => path.join(dir, 'missing'), trashItem })
    expect(await library.list()).toEqual([])
  })

  it('reads covers', async () => {
    makeSong(dir, { title: 'Song', cover: true })
    makeSong(dir, { title: 'Bare' })
    expect((await library.cover('Song.mp3')).mime).toBe('image/jpeg')
    expect(await library.cover('Bare.mp3')).toBeNull()
  })

  it('refuses files outside the folder or that are not songs', async () => {
    const outside = path.join(path.dirname(dir), `${path.basename(dir)}-outside.mp3`)
    fs.writeFileSync(outside, 'x')
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'x')
    try {
      for (const name of [`../${path.basename(outside)}`, outside, 'notes.txt', 'Missing.mp3']) {
        await expect(library.get(name)).rejects.toThrow(MESSAGES.NOT_FOUND)
        await expect(library.cover(name)).rejects.toThrow(MESSAGES.NOT_FOUND)
        await expect(library.rename(name, 'x')).rejects.toThrow(MESSAGES.NOT_FOUND)
        await expect(library.remove(name)).rejects.toThrow(MESSAGES.NOT_FOUND)
      }
      expect(fs.existsSync(outside)).toBe(true)
      expect(trashItem).not.toHaveBeenCalled()
    } finally {
      fs.rmSync(outside)
    }
  })

  it('renames songs', async () => {
    makeSong(dir, { title: 'Song' })
    expect(await library.rename('Song.mp3', 'Better: name')).toBe('Better name.mp3')
    expect(fs.readdirSync(dir)).toEqual(['Better name.mp3'])
    expect(await library.rename('Better name.mp3', 'Better name')).toBe('Better name.mp3')
  })

  it('changes only the case of a name', async () => {
    makeSong(dir, { title: 'song' })
    expect(await library.rename('song.mp3', 'Song')).toBe('Song.mp3')
    expect(fs.readdirSync(dir)).toEqual(['Song.mp3'])
  })

  it('does not overwrite another song or accept bad names', async () => {
    makeSong(dir, { title: 'One' })
    makeSong(dir, { title: 'Two' })
    await expect(library.rename('One.mp3', 'Two')).rejects.toThrow(MESSAGES.EXISTS)
    await expect(library.rename('One.mp3', '   ')).rejects.toThrow(MESSAGES.EMPTY_NAME)
    await expect(library.rename('One.mp3', '../../escape')).resolves.toBe('escape.mp3')
    expect(fs.readdirSync(dir).sort()).toEqual(['Two.mp3', 'escape.mp3'])
  })

  it('moves songs to the trash', async () => {
    makeSong(dir, { title: 'Song' })
    await library.remove('Song.mp3')
    expect(trashItem).toHaveBeenCalledWith(path.join(dir, 'Song.mp3'))
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it('reports when the trash fails', async () => {
    makeSong(dir, { title: 'Song' })
    trashItem.mockRejectedValue(new Error('no trash on /media/usb'))
    await expect(library.remove('Song.mp3')).rejects.toThrow(MESSAGES.DELETE_FAILED)
  })

  it('follows the current folder', async () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'yas-library-'))
    let folder = dir
    library = createLibrary({ getFolder: () => folder, trashItem })
    makeSong(other, { title: 'Elsewhere' })
    expect(await library.list()).toEqual([])
    folder = other
    expect((await library.list()).map(song => song.name)).toEqual(['Elsewhere.mp3'])
    fs.rmSync(other, { recursive: true, force: true })
  })
})

describe('shareMenuTemplate', () => {
  const copyText = vi.fn()
  const showItem = vi.fn()

  it('offers the system share sheet on macOS', () => {
    const template = shareMenuTemplate({ platform: 'darwin', file: '/m/A.mp3', link: LINK, copyText, showItem })
    expect(template[0]).toEqual({ role: 'shareMenu', label: 'Share', sharingItem: { filePaths: ['/m/A.mp3'] } })
    expect(template.map(item => item.label ?? item.type)).toEqual(['Share', 'separator', 'Copy YouTube link', 'Show in Finder'])
  })

  it('copies the link and shows the file on every system', () => {
    const template = shareMenuTemplate({ platform: 'win32', file: 'C:\\m\\A.mp3', link: LINK, copyText, showItem })
    expect(template.map(item => item.label)).toEqual(['Copy YouTube link', 'Show in folder'])
    template[0].click()
    template[1].click()
    expect(copyText).toHaveBeenCalledWith(LINK)
    expect(showItem).toHaveBeenCalledWith('C:\\m\\A.mp3')
  })

  it('leaves out the link when the song has none', () => {
    const template = shareMenuTemplate({ platform: 'linux', file: '/m/A.mp3', link: null, copyText, showItem })
    expect(template.map(item => item.label)).toEqual(['Show in folder'])
  })
})
