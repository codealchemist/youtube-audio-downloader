import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron'
import squirrelStartup from 'electron-squirrel-startup'
import Store from 'electron-store'
import ffmpegPath from 'ffmpeg-static'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { downloader, parseVideoId } from 'youtube-audio-server'
import { createDownloadService } from './download-service.js'
import { applyFolder, changeFolder, defaultFolder, resolveFolder } from './folder.js'
import { registerIpc } from './ipc.js'
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
  schema: { audioFolder: { type: 'string' } }
})
const service = createDownloadService({ downloader, parseVideoId })
let mainWindow = null
let folderWarning = null

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
  service,
  isTrusted: event => isTrustedSender(event, indexFile),
  getState: () => ({
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
  showFile: file => shell.showItemInFolder(file)
})

app.on('web-contents-created', (event, contents) => hardenContents(contents))

async function createWindow () {
  mainWindow = new BrowserWindow(windowOptions(preloadFile))
  mainWindow.on('closed', () => { mainWindow = null })

  setFolder(await resolveFolder({
    store,
    choose: chooseFolder,
    fallback: fallbackFolder(),
    override: testEnv.YAS_AUDIO_FOLDER
  }))

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
