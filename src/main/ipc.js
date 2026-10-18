// IPC handlers behind the preload bridge. Every handler checks that the call
// comes from the app's page and treats its arguments as untrusted input.

export const CHANNELS = {
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
  // Sent to the page.
  queueChanged: 'yas:queue-changed',
  songsChanged: 'yas:songs-changed'
}

const text = value => (typeof value === 'string' ? value : '')

// Library errors carry a message written for the window; anything else
// could contain paths, so it is replaced.
function failure (error, fallback) {
  return { ok: false, error: error?.name === 'LibraryError' ? error.message : fallback }
}

export function registerIpc ({ ipcMain, isTrusted, getState, changeFolder, queue, library, confirmDelete, shareSong, showSong, songsChanged }) {
  const handle = (channel, handler) => {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isTrusted(event)) throw new Error('Untrusted sender')
      return handler(...args)
    })
  }

  // Errors are returned rather than thrown: Electron prefixes thrown messages
  // with internal details.
  const songAction = (channel, action, fallback) => handle(channel, async (...args) => {
    try {
      return { ok: true, ...(await action(...args)) }
    } catch (error) {
      return failure(error, fallback)
    }
  })

  handle(CHANNELS.getState, () => getState())
  handle(CHANNELS.changeFolder, () => changeFolder())

  handle(CHANNELS.getQueue, () => queue.items())
  handle(CHANNELS.addToQueue, input => queue.add(text(input)))
  handle(CHANNELS.removeFromQueue, key => queue.remove(text(key)))
  handle(CHANNELS.retryDownload, key => queue.retry(text(key)))
  handle(CHANNELS.clearFinished, () => { queue.clearFinished() })

  handle(CHANNELS.listSongs, () => library.list())
  handle(CHANNELS.getCover, name => library.cover(text(name)).catch(() => null))

  songAction(CHANNELS.renameSong, async (name, title) => {
    const newName = await library.rename(text(name), text(title))
    songsChanged()
    return { name: newName }
  }, 'The song could not be renamed.')

  songAction(CHANNELS.deleteSong, async name => {
    const song = await library.get(text(name))
    if (!await confirmDelete(song)) return { deleted: false }
    await library.remove(song.name)
    songsChanged()
    return { deleted: true }
  }, 'The song could not be deleted.')

  songAction(CHANNELS.shareSong, async name => {
    const song = await library.get(text(name))
    const { file } = await library.resolve(song.name)
    shareSong({ file, link: song.link })
  }, 'The song could not be shared.')

  songAction(CHANNELS.showSong, async name => {
    const { file } = await library.resolve(text(name))
    showSong(file)
  }, 'The song could not be shown.')
}
