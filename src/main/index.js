import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, session, shell } from 'electron'
import squirrelStartup from 'electron-squirrel-startup'
import Store from 'electron-store'
import ffmpegPath from 'ffmpeg-static'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { downloader, parseVideoId } from 'youtube-audio-server'
import { createDownloadService } from './download-service.js'
import { FOLDER_KEY, applyFolder, changeFolder, defaultFolder, resolveFolder } from './folder.js'
import { CHANNELS, registerIpc } from './ipc.js'
import { createLibrary, shareMenuTemplate } from './library.js'
import { createQueue } from './queue.js'
import { denyPermissions, hardenContents, isTrustedSender, windowOptions } from './security.js'
import { configureTools, missingTools, toolStatus } from './tools.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const indexFile = path.join(here, '../renderer/index.html')
const preloadFile = path.join(here, '../preload/preload.cjs')

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (squirrelStartup) app.quit()

// Tests run the app with their own settings and download folder.
const testEnv = app.isPackaged ? {} : process.env
if (testEnv.YAS_USER_DATA) app.setPath('userData', testEnv.YAS_USER_DATA)

configureTools({ ffmpegPath })
downloader.youtube.quiet = true

const store = new Store({
  schema: { [FOLDER_KEY]: { type: 'string' } }
})
let mainWindow = null
let folderWarning = null

// Events for the page, dropped while there is no window.
const notify = (channel, data) => {
  const contents = mainWindow?.webContents
  if (contents && !contents.isDestroyed()) contents.send(channel, data)
}

const service = createDownloadService({ downloader, parseVideoId })
const queue = createQueue({
  service,
  parseVideoId,
  onChange: items => notify(CHANNELS.queueChanged, items),
  onSaved: () => notify(CHANNELS.songsChanged)
})
const library = createLibrary({
  getFolder: () => downloader.youtube.audioFolder,
  trashItem: file => shell.trashItem(file)
})

const TRASH = { darwin: 'Trash', win32: 'Recycle Bin' }

async function confirmDelete (song) {
  const trash = TRASH[process.platform] ?? 'trash'
  const options = {
    type: 'question',
    buttons: [`Move to ${trash}`, 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    message: `Delete “${song.title}”?`,
    detail: `The file is moved to the ${trash}.`
  }
  const { response } = mainWindow
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options)
  return response === 0
}

function shareSong ({ file, link }) {
  const template = shareMenuTemplate({
    platform: process.platform,
    file,
    link,
    copyText: value => clipboard.writeText(value),
    showItem: item => shell.showItemInFolder(item)
  })
  Menu.buildFromTemplate(template).popup(mainWindow ? { window: mainWindow } : {})
}

const chooseFolder = async () => {
  const options = { title: 'Choose where to save audio', properties: ['openDirectory', 'createDirectory'] }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  return result.canceled ? null : result.filePaths[0]
}

const fallbackFolder = () => defaultFolder(app.getPath('music'))

const setFolder = (folder, fallback = fallbackFolder()) => {
  const result = applyFolder({ downloader, folder, fallback })
  folderWarning = result.warning
  return result
}

registerIpc({
  ipcMain,
  isTrusted: event => isTrustedSender(event, indexFile),
  getState: () => ({
    version: app.getVersion(),
    folder: downloader.youtube.audioFolder,
    folderWarning,
    missing: missingTools(toolStatus())
  }),
  changeFolder: async () => {
    if (service.isBusy()) return null
    // If the new folder can't be used, keep saving where we were.
    const current = downloader.youtube.audioFolder
    return changeFolder({ store, choose: chooseFolder, apply: folder => setFolder(folder, current) })
  },
  queue,
  library,
  confirmDelete,
  shareSong,
  showSong: file => shell.showItemInFolder(file),
  songsChanged: () => notify(CHANNELS.songsChanged)
})

app.on('web-contents-created', (event, contents) => hardenContents(contents))

async function createWindow () {
  mainWindow = new BrowserWindow(windowOptions(preloadFile))
  mainWindow.on('closed', () => { mainWindow = null })

  await resolveFolder({
    store,
    choose: chooseFolder,
    apply: folder => setFolder(folder),
    fallback: fallbackFolder(),
    override: testEnv.YAS_AUDIO_FOLDER
  })

  await mainWindow.loadFile(indexFile)
}

app.whenReady().then(() => {
  denyPermissions(session.defaultSession)
  createWindow()
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
