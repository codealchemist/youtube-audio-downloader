import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { FOLDER_KEY, applyFolder, changeFolder, defaultFolder, resolveFolder } from '../../src/main/folder.js'

function memoryStore (initial = {}) {
  const data = { ...initial }
  return { get: key => data[key], set: (key, value) => { data[key] = value }, data }
}

describe('resolveFolder', () => {
  it('uses the saved folder without asking', async () => {
    const choose = vi.fn()
    const folder = await resolveFolder({ store: memoryStore({ [FOLDER_KEY]: '/saved' }), choose, fallback: '/fallback' })
    expect(folder).toBe('/saved')
    expect(choose).not.toHaveBeenCalled()
  })

  it('asks the first time and saves the answer', async () => {
    const store = memoryStore()
    const folder = await resolveFolder({ store, choose: async () => '/picked', fallback: '/fallback' })
    expect(folder).toBe('/picked')
    expect(store.data[FOLDER_KEY]).toBe('/picked')
  })

  it('falls back when the picker is cancelled', async () => {
    const store = memoryStore()
    const folder = await resolveFolder({ store, choose: async () => null, fallback: '/fallback' })
    expect(folder).toBe('/fallback')
    expect(store.data[FOLDER_KEY]).toBe('/fallback')
  })

  it('prefers an override and leaves the store alone', async () => {
    const store = memoryStore({ [FOLDER_KEY]: '/saved' })
    expect(await resolveFolder({ store, choose: vi.fn(), fallback: '/f', override: '/test' })).toBe('/test')
    expect(store.data[FOLDER_KEY]).toBe('/saved')
  })
})

// Like youtube-audio-server's downloader: setFolder keeps the old folder
// when the new one can't be created.
function fakeDownloader ({ usable, current = '/' }) {
  return {
    youtube: { audioFolder: current },
    setFolder (folder) {
      if (usable.includes(folder)) this.youtube.audioFolder = folder
    }
  }
}

describe('applyFolder', () => {
  const wanted = path.resolve('/Volumes/USB/Music')
  const fallback = path.resolve('/Users/me/Music/YouTube Audio')

  it('uses the folder when it can be created', () => {
    const downloader = fakeDownloader({ usable: [wanted] })
    expect(applyFolder({ downloader, folder: wanted, fallback })).toEqual({ folder: wanted, warning: null })
    expect(downloader.youtube.audioFolder).toBe(wanted)
  })

  it('falls back with a warning instead of saving to /', () => {
    const downloader = fakeDownloader({ usable: [fallback] })
    const result = applyFolder({ downloader, folder: wanted, fallback })
    expect(result.folder).toBe(fallback)
    expect(result.warning).toBe(`Couldn't use ${wanted}, so audio is saved to ${fallback} instead.`)
    expect(downloader.youtube.audioFolder).toBe(fallback)
  })

  it('asks for another folder when the fallback fails too', () => {
    const downloader = fakeDownloader({ usable: [] })
    const result = applyFolder({ downloader, folder: wanted, fallback })
    expect(result.folder).toBe('/')
    expect(result.warning).toBe(`Couldn't use ${wanted}. Choose another folder.`)
  })

  it('resolves relative folders before comparing', () => {
    const downloader = fakeDownloader({ usable: [path.resolve('music')] })
    expect(applyFolder({ downloader, folder: 'music', fallback })).toEqual({ folder: path.resolve('music'), warning: null })
  })
})

describe('changeFolder', () => {
  it('saves a folder that works', async () => {
    const store = memoryStore({ [FOLDER_KEY]: '/old' })
    const result = await changeFolder({ store, choose: async () => '/new', apply: folder => ({ folder, warning: null }) })
    expect(result).toEqual({ folder: '/new', warning: null })
    expect(store.data[FOLDER_KEY]).toBe('/new')
  })

  it('does not save a folder that could not be used', async () => {
    const store = memoryStore({ [FOLDER_KEY]: '/old' })
    const result = await changeFolder({ store, choose: async () => '/broken', apply: () => ({ folder: '/old', warning: 'nope' }) })
    expect(result).toEqual({ folder: '/old', warning: 'nope' })
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
