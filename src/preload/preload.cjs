// Runs sandboxed, so it can only use the parts of electron exposed to
// preloads. Channel names must match src/main/ipc.js (a test checks this).
const { contextBridge, ipcRenderer } = require('electron')

const CHANNELS = {
  download: 'yas:download',
  metadata: 'yas:metadata',
  progress: 'yas:progress',
  getState: 'yas:get-state',
  changeFolder: 'yas:change-folder',
  showFile: 'yas:show-file'
}

// Subscribes to a main-process event and returns a function that unsubscribes.
// The listener only receives the data, never the IPC event.
function subscribe (channel, callback) {
  const listener = (event, data) => callback(data)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('yas', {
  download: input => ipcRenderer.invoke(CHANNELS.download, String(input)),
  getState: () => ipcRenderer.invoke(CHANNELS.getState),
  changeFolder: () => ipcRenderer.invoke(CHANNELS.changeFolder),
  showFile: file => ipcRenderer.invoke(CHANNELS.showFile, String(file)),
  onMetadata: callback => subscribe(CHANNELS.metadata, callback),
  onProgress: callback => subscribe(CHANNELS.progress, callback)
})
