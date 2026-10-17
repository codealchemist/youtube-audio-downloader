import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { FOLDER_KEY, changeFolder, defaultFolder, resolveFolder } from '../../src/main/folder.js'

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

describe('changeFolder', () => {
  it('saves the new folder', async () => {
    const store = memoryStore({ [FOLDER_KEY]: '/old' })
    expect(await changeFolder({ store, choose: async () => '/new' })).toBe('/new')
    expect(store.data[FOLDER_KEY]).toBe('/new')
  })

  it('keeps the old folder when cancelled', async () => {
    const store = memoryStore({ [FOLDER_KEY]: '/old' })
    expect(await changeFolder({ store, choose: async () => null })).toBe(null)
    expect(store.data[FOLDER_KEY]).toBe('/old')
  })
})

it('defaultFolder is inside the music folder', () => {
  expect(defaultFolder('/Users/me/Music')).toBe(path.join('/Users/me/Music', 'YouTube Audio'))
})
