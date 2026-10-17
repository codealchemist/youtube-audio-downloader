import fs from 'node:fs'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { CHANNELS, registerIpc } from '../../src/main/ipc.js'

function fakeIpcMain () {
  const handlers = {}
  return { handle: (channel, handler) => { handlers[channel] = handler }, handlers }
}

function fakeEvent ({ trusted = true, destroyed = false } = {}) {
  return { trusted, sender: { isDestroyed: () => destroyed, send: vi.fn() } }
}

function setup (overrides = {}) {
  const ipcMain = fakeIpcMain()
  const service = {
    download: vi.fn(async (input, { onMetadata, onProgress }) => {
      onMetadata({ id: input, title: 'T' })
      onProgress({ id: input, downloaded: 1 })
      return { id: input, file: '/m/T.mp3', filename: 'T', url: 'file:///m/T.mp3' }
    }),
    isDownloaded: file => file === '/m/T.mp3',
    ...overrides.service
  }
  const deps = {
    ipcMain,
    service,
    isTrusted: event => event.trusted,
    getState: vi.fn(() => ({ folder: '/m' })),
    changeFolder: vi.fn(async () => '/new'),
    showFile: vi.fn()
  }
  registerIpc(deps)
  return { ...deps, call: (channel, event, ...args) => ipcMain.handlers[channel](event, ...args) }
}

describe('registerIpc', () => {
  it('registers every channel', () => {
    const { ipcMain } = setup()
    expect(Object.keys(ipcMain.handlers).sort()).toEqual(
      [CHANNELS.download, CHANNELS.getState, CHANNELS.changeFolder, CHANNELS.showFile].sort()
    )
  })

  it('refuses untrusted senders', async () => {
    const { call, service } = setup()
    for (const channel of [CHANNELS.download, CHANNELS.getState, CHANNELS.changeFolder, CHANNELS.showFile]) {
      await expect(call(channel, fakeEvent({ trusted: false }), 'x')).rejects.toThrow('Untrusted sender')
    }
    expect(service.download).not.toHaveBeenCalled()
  })

  it('downloads and forwards metadata and progress', async () => {
    const { call } = setup()
    const event = fakeEvent()
    const result = await call(CHANNELS.download, event, 'abc')
    expect(result).toEqual({ ok: true, id: 'abc', file: '/m/T.mp3', filename: 'T', url: 'file:///m/T.mp3' })
    expect(event.sender.send).toHaveBeenCalledWith(CHANNELS.metadata, { id: 'abc', title: 'T' })
    expect(event.sender.send).toHaveBeenCalledWith(CHANNELS.progress, { id: 'abc', downloaded: 1 })
  })

  it('does not send to a closed window', async () => {
    const { call } = setup()
    const event = fakeEvent({ destroyed: true })
    await call(CHANNELS.download, event, 'abc')
    expect(event.sender.send).not.toHaveBeenCalled()
  })

  it('returns a safe error message', async () => {
    const { call } = setup({ service: { download: async () => { throw new Error('/private/path exploded') } } })
    expect(await call(CHANNELS.download, fakeEvent(), 'abc')).toEqual({ ok: false, error: 'The download failed.' })
  })

  it('only reveals downloaded files', async () => {
    const { call, showFile } = setup()
    expect(await call(CHANNELS.showFile, fakeEvent(), '/etc/passwd')).toBe(false)
    expect(await call(CHANNELS.showFile, fakeEvent(), { toString: () => '/m/T.mp3' })).toBe(false)
    expect(showFile).not.toHaveBeenCalled()
    expect(await call(CHANNELS.showFile, fakeEvent(), '/m/T.mp3')).toBe(true)
    expect(showFile).toHaveBeenCalledWith('/m/T.mp3')
  })

  it('returns state and changes the folder', async () => {
    const { call } = setup()
    expect(await call(CHANNELS.getState, fakeEvent())).toEqual({ folder: '/m' })
    expect(await call(CHANNELS.changeFolder, fakeEvent())).toBe('/new')
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
    await api.download('id')
    await api.getState()
    await api.changeFolder()
    await api.showFile('/m/T.mp3')
    expect(ipcRenderer.invoke.mock.calls).toEqual([
      [CHANNELS.download, 'id'],
      [CHANNELS.getState],
      [CHANNELS.changeFolder],
      [CHANNELS.showFile, '/m/T.mp3']
    ])
  })

  it('hides the IPC event from listeners and can unsubscribe', () => {
    const { api, ipcRenderer } = loadPreload()
    const callback = vi.fn()
    const unsubscribe = api.onProgress(callback)
    const [channel, listener] = ipcRenderer.on.mock.calls[0]
    expect(channel).toBe(CHANNELS.progress)

    listener({ sender: 'secret' }, { downloaded: 5 })
    expect(callback).toHaveBeenCalledWith({ downloaded: 5 })

    unsubscribe()
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(CHANNELS.progress, listener)
    api.onMetadata(callback)
    expect(ipcRenderer.on.mock.calls[1][0]).toBe(CHANNELS.metadata)
  })

  it('exposes only the bridge functions', () => {
    const { api } = loadPreload()
    expect(Object.keys(api).sort()).toEqual(['changeFolder', 'download', 'getState', 'onMetadata', 'onProgress', 'showFile'])
  })
})
