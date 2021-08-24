const { app, BrowserWindow, dialog } = require('electron')
const path = require('path')
const Store = require('electron-store')
const store = new Store()
require('./setup-ffmpeg')
require('./bridge')
const yas = require('youtube-audio-server')

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) { // eslint-disable-line global-require
  app.quit();
}

const createWindow = async () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 840,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    }
  });

  // TODO: Inform user before forcing first time folder selection.
  // TODO: Provide UI to change folder.
  // Set audio download folder.
  let audioFolder = store.get('audioFolder')
  if (!audioFolder) {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory']
    })
    audioFolder = result.filePaths?.[0]
    console.log('Selected audio folder:', audioFolder)
    store.set('audioFolder', audioFolder)
  }
  yas.downloader.setFolder(audioFolder)

  // and load the index.html of the app.
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Open the DevTools.
  // mainWindow.webContents.openDevTools();
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow);

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

