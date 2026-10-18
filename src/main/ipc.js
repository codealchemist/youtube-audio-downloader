// IPC handlers behind the preload bridge. Every handler checks that the call
// comes from the app's page and treats its arguments as untrusted input.
import { userMessage } from './download-service.js'

export const CHANNELS = {
  download: 'yas:download',
  metadata: 'yas:metadata',
  progress: 'yas:progress',
  getState: 'yas:get-state',
  changeFolder: 'yas:change-folder',
  showFile: 'yas:show-file'
}

export function registerIpc ({ ipcMain, service, isTrusted, getState, changeFolder, showFile }) {
  const handle = (channel, handler) => {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isTrusted(event)) throw new Error('Untrusted sender')
      return handler(event, ...args)
    })
  }

  // Errors are returned rather than thrown: Electron prefixes thrown messages
  // with internal details.
  handle(CHANNELS.download, async (event, input) => {
    const send = (channel, data) => {
      if (!event.sender.isDestroyed()) event.sender.send(channel, data)
    }
    try {
      const result = await service.download(input, {
        onMetadata: metadata => send(CHANNELS.metadata, metadata),
        onProgress: progress => send(CHANNELS.progress, progress)
      })
      return { ok: true, ...result }
    } catch (error) {
      return { ok: false, error: userMessage(error) }
    }
  })

  handle(CHANNELS.getState, () => getState())
  handle(CHANNELS.changeFolder, () => changeFolder())
  handle(CHANNELS.showFile, (event, file) => {
    if (typeof file !== 'string' || !service.isDownloaded(file)) return false
    showFile(file)
    return true
  })
}
