import fs from 'node:fs'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { CHANNELS, registerIpc } from '../../src/main/ipc.js'
import { LibraryError } from '../../src/main/library.js'

function fakeIpcMain () {
  const handlers = {}
  return { handle: (channel, handler) => { handlers[channel] = handler }, handlers }
}

const SONG = { name: 'Song.mp3', title: 'Song', link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }

function setup (overrides = {}) {
  const ipcMain = fakeIpcMain()
  const queue = {
    items: vi.fn(() => [{ key: '1' }]),
    add: vi.fn(() => ({ added: 1 })),
    remove: vi.fn(() => true),
    retry: vi.fn(() => true),
    clearFinished: vi.fn()
  }
  const library = {
    list: vi.fn(async () => [SONG]),
    get: vi.fn(async name => {
      if (name !== SONG.name) throw new LibraryError('That song is no longer in the folder.')
      return SONG
    }),
    resolve: vi.fn(async name => {
      if (name !== SONG.name) throw new LibraryError('That song is no longer in the folder.')
      return { file: '/m/Song.mp3' }
    }),
    cover: vi.fn(async () => ({ mime: 'image/jpeg', data: Buffer.from([1]) })),
    rename: vi.fn(async () => 'New.mp3'),
    remove: vi.fn(async () => {}),
    ...overrides.library
  }
  const deps = {
    ipcMain,
    isTrusted: event => event.trusted,
    getState: vi.fn(() => ({ folder: '/m' })),
    changeFolder: vi.fn(async () => ({ folder: '/new' })),
    queue,
    library,
    confirmDelete: vi.fn(async () => true),
    shareSong: vi.fn(),
    showSong: vi.fn(),
    songsChanged: vi.fn(),
    ...overrides.deps
  }
  registerIpc(deps)
  const call = (channel, ...args) => ipcMain.handlers[channel]({ trusted: true }, ...args)
  return { ...deps, call }
}

// The channels the page invokes; the rest are events sent to it.
const EVENT_CHANNELS = [CHANNELS.queueChanged, CHANNELS.songsChanged]
const INVOKE_CHANNELS = Object.values(CHANNELS).filter(channel => !EVENT_CHANNELS.includes(channel))

describe('registerIpc', () => {
  it('registers every channel the page invokes', () => {
    const { ipcMain } = setup()
    expect(Object.keys(ipcMain.handlers).sort()).toEqual([...INVOKE_CHANNELS].sort())
  })

  it('refuses untrusted senders', async () => {
    const { ipcMain, queue, library } = setup()
    for (const channel of INVOKE_CHANNELS) {
      await expect(ipcMain.handlers[channel]({ trusted: false }, 'x')).rejects.toThrow('Untrusted sender')
    }
    expect(queue.add).not.toHaveBeenCalled()
    expect(library.remove).not.toHaveBeenCalled()
  })

  it('returns state and changes the folder', async () => {
    const { call } = setup()
    expect(await call(CHANNELS.getState)).toEqual({ folder: '/m' })
    expect(await call(CHANNELS.changeFolder)).toEqual({ folder: '/new' })
  })

  it('passes queue requests on, as strings only', async () => {
    const { call, queue } = setup()
    expect(await call(CHANNELS.getQueue)).toEqual([{ key: '1' }])
    expect(await call(CHANNELS.addToQueue, 'dQw4w9WgXcQ')).toEqual({ added: 1 })
    await call(CHANNELS.addToQueue, { toString: () => 'sneaky' })
    expect(queue.add.mock.calls).toEqual([['dQw4w9WgXcQ'], ['']])

    expect(await call(CHANNELS.removeFromQueue, '1')).toBe(true)
    expect(await call(CHANNELS.retryDownload, '2')).toBe(true)
    await call(CHANNELS.clearFinished)
    expect(queue.remove).toHaveBeenCalledWith('1')
    expect(queue.retry).toHaveBeenCalledWith('2')
    expect(queue.clearFinished).toHaveBeenCalled()
  })

  it('lists songs and reads covers, with no cover for unknown songs', async () => {
    const { call, library } = setup({ library: { cover: vi.fn(async () => { throw new LibraryError('gone') }) } })
    expect(await call(CHANNELS.listSongs)).toEqual([SONG])
    expect(await call(CHANNELS.getCover, '../etc/passwd')).toBeNull()
    expect(library.cover).toHaveBeenCalledWith('../etc/passwd')
  })

  it('renames a song and tells the page', async () => {
    const { call, library, songsChanged } = setup()
    expect(await call(CHANNELS.renameSong, 'Song.mp3', 'New')).toEqual({ ok: true, name: 'New.mp3' })
    expect(library.rename).toHaveBeenCalledWith('Song.mp3', 'New')
    expect(songsChanged).toHaveBeenCalled()
  })

  it('shows library errors but hides other errors', async () => {
    const { call } = setup({
      library: {
        rename: vi.fn(async (name, title) => {
          if (title === 'taken') throw new LibraryError('Another song already has that name.')
          throw new Error('EACCES: /private/path')
        })
      }
    })
    expect(await call(CHANNELS.renameSong, 'Song.mp3', 'taken')).toEqual({ ok: false, error: 'Another song already has that name.' })
    expect(await call(CHANNELS.renameSong, 'Song.mp3', 'other')).toEqual({ ok: false, error: 'The song could not be renamed.' })
  })

  it('deletes a song only after the user confirms', async () => {
    const confirmDelete = vi.fn(async () => false)
    const { call, library, songsChanged } = setup({ deps: { confirmDelete } })
    expect(await call(CHANNELS.deleteSong, 'Song.mp3')).toEqual({ ok: true, deleted: false })
    expect(confirmDelete).toHaveBeenCalledWith(SONG)
    expect(library.remove).not.toHaveBeenCalled()

    confirmDelete.mockResolvedValue(true)
    expect(await call(CHANNELS.deleteSong, 'Song.mp3')).toEqual({ ok: true, deleted: true })
    expect(library.remove).toHaveBeenCalledWith('Song.mp3')
    expect(songsChanged).toHaveBeenCalled()
  })

  it('does not ask before deleting a song that is not in the folder', async () => {
    const { call, confirmDelete } = setup()
    expect(await call(CHANNELS.deleteSong, '/etc/passwd')).toEqual({ ok: false, error: 'That song is no longer in the folder.' })
    expect(confirmDelete).not.toHaveBeenCalled()
  })

  it('shares and shows songs in the folder only', async () => {
    const { call, shareSong, showSong } = setup()
    expect(await call(CHANNELS.shareSong, 'Song.mp3')).toEqual({ ok: true })
    expect(shareSong).toHaveBeenCalledWith({ file: '/m/Song.mp3', link: SONG.link })
    expect(await call(CHANNELS.showSong, 'Song.mp3')).toEqual({ ok: true })
    expect(showSong).toHaveBeenCalledWith('/m/Song.mp3')

    expect((await call(CHANNELS.showSong, '../secret.mp3')).ok).toBe(false)
    expect((await call(CHANNELS.shareSong, { name: 'Song.mp3' })).ok).toBe(false)
    expect(showSong).toHaveBeenCalledTimes(1)
    expect(shareSong).toHaveBeenCalledTimes(1)
  })
})

describe('preload bridge', () => {
  // Runs the preload script with a fake `electron`, the way Electron's
  // sandbox does, and returns what it exposes to the page.
  function loadPreload () {
    const exposed = {}
    const ipcRenderer = { invoke: vi.fn(async () => 'ok'), on: vi.fn(), removeListener: vi.fn() }
    const electron = { contextBridge: { exposeInMainWorld: (name, api) => { exposed[name] = api } }, ipcRenderer }
    const code = fs.readFileSync(new URL('../../src/preload/preload.cjs', import.meta.url), 'utf8')
    vm.runInNewContext(code, { require: name => (name === 'electron' ? electron : undefined), String })
    return { api: exposed.yas, ipcRenderer }
  }

  it('uses the same channels as the main process', async () => {
    const { api, ipcRenderer } = loadPreload()
    await api.getState()
    await api.changeFolder()
    await api.getQueue()
    await api.addToQueue('id')
    await api.removeFromQueue('1')
    await api.retryDownload('2')
    await api.clearFinished()
    await api.listSongs()
    await api.getCover('A.mp3')
    await api.renameSong('A.mp3', 'B')
    await api.deleteSong('A.mp3')
    await api.shareSong('A.mp3')
    await api.showSong('A.mp3')
    expect(ipcRenderer.invoke.mock.calls).toEqual([
      [CHANNELS.getState],
      [CHANNELS.changeFolder],
      [CHANNELS.getQueue],
      [CHANNELS.addToQueue, 'id'],
      [CHANNELS.removeFromQueue, '1'],
      [CHANNELS.retryDownload, '2'],
      [CHANNELS.clearFinished],
      [CHANNELS.listSongs],
      [CHANNELS.getCover, 'A.mp3'],
      [CHANNELS.renameSong, 'A.mp3', 'B'],
      [CHANNELS.deleteSong, 'A.mp3'],
      [CHANNELS.shareSong, 'A.mp3'],
      [CHANNELS.showSong, 'A.mp3']
    ])
  })

  it('sends only strings', async () => {
    const { api, ipcRenderer } = loadPreload()
    await api.renameSong({ evil: true }, 42)
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(CHANNELS.renameSong, '[object Object]', '42')
  })

  it('hides the IPC event from listeners and can unsubscribe', () => {
    const { api, ipcRenderer } = loadPreload()
    const callback = vi.fn()
    const unsubscribe = api.onQueueChanged(callback)
    const [channel, listener] = ipcRenderer.on.mock.calls[0]
    expect(channel).toBe(CHANNELS.queueChanged)

    listener({ sender: 'secret' }, [{ key: '1' }])
    expect(callback).toHaveBeenCalledWith([{ key: '1' }])

    unsubscribe()
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(CHANNELS.queueChanged, listener)
    api.onSongsChanged(callback)
    expect(ipcRenderer.on.mock.calls[1][0]).toBe(CHANNELS.songsChanged)
  })

  it('exposes only the bridge functions', () => {
    const { api } = loadPreload()
    expect(Object.keys(api).sort()).toEqual([
      'addToQueue', 'changeFolder', 'clearFinished', 'deleteSong', 'getCover', 'getQueue', 'getState',
      'listSongs', 'onQueueChanged', 'onSongsChanged', 'removeFromQueue', 'renameSong', 'retryDownload',
      'shareSong', 'showSong'
    ])
  })
})
