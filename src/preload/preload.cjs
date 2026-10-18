// Runs sandboxed, so it can only use the parts of electron exposed to
// preloads. Channel names must match src/main/ipc.js (a test checks this).
const { contextBridge, ipcRenderer } = require('electron')

const CHANNELS = {
  getState: 'yas:get-state',
  changeFolder: 'yas:change-folder',
  getQueue: 'yas:queue-get',
  addToQueue: 'yas:queue-add',
  removeFromQueue: 'yas:queue-remove',
  retryDownload: 'yas:queue-retry',
  clearFinished: 'yas:queue-clear',
  listSongs: 'yas:songs-list',
  getCover: 'yas:song-cover',
  renameSong: 'yas:song-rename',
  deleteSong: 'yas:song-delete',
  shareSong: 'yas:song-share',
  showSong: 'yas:song-show',
  queueChanged: 'yas:queue-changed',
  songsChanged: 'yas:songs-changed'
}

// Subscribes to a main-process event and returns a function that unsubscribes.
// The listener only receives the data, never the IPC event.
function subscribe (channel, callback) {
  const listener = (event, data) => callback(data)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args.map(String))

contextBridge.exposeInMainWorld('yas', {
  getState: () => invoke(CHANNELS.getState),
  changeFolder: () => invoke(CHANNELS.changeFolder),
  getQueue: () => invoke(CHANNELS.getQueue),
  addToQueue: input => invoke(CHANNELS.addToQueue, input),
  removeFromQueue: key => invoke(CHANNELS.removeFromQueue, key),
  retryDownload: key => invoke(CHANNELS.retryDownload, key),
  clearFinished: () => invoke(CHANNELS.clearFinished),
  listSongs: () => invoke(CHANNELS.listSongs),
  getCover: name => invoke(CHANNELS.getCover, name),
  renameSong: (name, title) => invoke(CHANNELS.renameSong, name, title),
  deleteSong: name => invoke(CHANNELS.deleteSong, name),
  shareSong: name => invoke(CHANNELS.shareSong, name),
  showSong: name => invoke(CHANNELS.showSong, name),
  onQueueChanged: callback => subscribe(CHANNELS.queueChanged, callback),
  onSongsChanged: callback => subscribe(CHANNELS.songsChanged, callback)
})
