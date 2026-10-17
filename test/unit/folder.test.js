import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { FOLDER_KEY, applyFolder, changeFolder, defaultFolder, resolveFolder } from '../../src/main/folder.js'

function memoryStore (initial = {}) {
  const data = { ...initial }
  return { get: key => data[key], set: (key, value) => { data[key] = value }, data }
}

// Applies like applyFolder when every folder works.
const applyOk = folder => ({ ok: true, folder, warning: null })

describe('resolveFolder', () => {
  it('uses the saved folder without asking', async () => {
    const choose = vi.fn()
    const result = await resolveFolder({ store: memoryStore({ [FOLDER_KEY]: '/saved' }), choose, apply: applyOk, fallback: '/fallback' })
    expect(result.folder).toBe('/saved')
    expect(choose).not.toHaveBeenCalled()
  })

  it('asks the first time and saves the answer', async () => {
    const store = memoryStore()
    const result = await resolveFolder({ store, choose: async () => '/picked', apply: applyOk, fallback: '/fallback' })
    expect(result.folder).toBe('/picked')
    expect(store.data[FOLDER_KEY]).toBe('/picked')
  })

  it('does not save a first pick that could not be used', async () => {
    const store = memoryStore()
    const apply = () => ({ ok: false, folder: '/fallback', warning: 'nope' })
    const result = await resolveFolder({ store, choose: async () => '/broken', apply, fallback: '/fallback' })
    expect(result.warning).toBe('nope')
    expect(store.data[FOLDER_KEY]).toBe(undefined)
  })

  it('falls back when the picker is cancelled', async () => {
    const store = memoryStore()
    const result = await resolveFolder({ store, choose: async () => null, apply: applyOk, fallback: '/fallback' })
    expect(result.folder).toBe('/fallback')
    expect(store.data[FOLDER_KEY]).toBe('/fallback')
  })

  it('prefers an override and leaves the store alone', async () => {
    const store = memoryStore({ [FOLDER_KEY]: '/saved' })
    const result = await resolveFolder({ store, choose: vi.fn(), apply: applyOk, fallback: '/f', override: '/test' })
    expect(result.folder).toBe('/test')
    expect(store.data[FOLDER_KEY]).toBe('/saved')
  })
})

function fakeDownloader (current = '/') {
  return {
    youtube: { audioFolder: current },
    setFolder (folder) { this.youtube.audioFolder = folder }
  }
}

describe('applyFolder', () => {
  const wanted = path.resolve('/Volumes/USB/Music')
  const fallback = path.resolve('/Users/me/Music/YouTube Audio')
  const creatable = (...folders) => folder => folders.includes(folder)

  it('uses the folder when it can be created', () => {
    const downloader = fakeDownloader()
    expect(applyFolder({ downloader, folder: wanted, fallback, create: creatable(wanted) }))
      .toEqual({ ok: true, folder: wanted, warning: null })
    expect(downloader.youtube.audioFolder).toBe(wanted)
  })

  it('falls back with a warning instead of saving to /', () => {
    const downloader = fakeDownloader()
    const result = applyFolder({ downloader, folder: wanted, fallback, create: creatable(fallback) })
    expect(result).toEqual({ ok: false, folder: fallback, warning: `Couldn't use ${wanted}, so audio is saved to ${fallback} instead.` })
    expect(downloader.youtube.audioFolder).toBe(fallback)
  })

  it('asks for another folder when the fallback fails too', () => {
    const downloader = fakeDownloader()
    const result = applyFolder({ downloader, folder: wanted, fallback, create: creatable() })
    expect(result).toEqual({ ok: false, folder: '/', warning: `Couldn't use ${wanted}. Choose another folder.` })
  })

  it('resolves relative folders', () => {
    const downloader = fakeDownloader()
    const music = path.resolve('music')
    expect(applyFolder({ downloader, folder: 'music', fallback, create: creatable(music) }).folder).toBe(music)
  })

  it('creates the folder on disk by default', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yas-folder-'))
    const target = path.join(dir, 'a', 'b')
    try {
      expect(applyFolder({ downloader: fakeDownloader(), folder: target, fallback }).ok).toBe(true)
      expect(fs.statSync(target).isDirectory()).toBe(true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('changeFolder', () => {
  it('saves a folder that works', async () => {
    const store = memoryStore({ [FOLDER_KEY]: '/old' })
    const result = await changeFolder({ store, choose: async () => '/new', apply: applyOk })
    expect(result).toEqual({ ok: true, folder: '/new', warning: null })
    expect(store.data[FOLDER_KEY]).toBe('/new')
  })

  it('does not save a folder that could not be used', async () => {
    const store = memoryStore({ [FOLDER_KEY]: '/old' })
    const result = await changeFolder({ store, choose: async () => '/broken', apply: () => ({ ok: false, folder: '/old', warning: 'nope' }) })
    expect(result).toEqual({ ok: false, folder: '/old', warning: 'nope' })
    expect(store.data[FOLDER_KEY]).toBe('/old')
  })

  it('keeps the old folder when cancelled', async () => {
    const store = memoryStore({ [FOLDER_KEY]: '/old' })
    const apply = vi.fn()
    expect(await changeFolder({ store, choose: async () => null, apply })).toBe(null)
    expect(apply).not.toHaveBeenCalled()
    expect(store.data[FOLDER_KEY]).toBe('/old')
  })
})

it('defaultFolder is inside the music folder', () => {
  expect(defaultFolder('/Users/me/Music')).toBe(path.join('/Users/me/Music', 'YouTube Audio'))
})
