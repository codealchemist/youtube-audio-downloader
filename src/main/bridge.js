const { ipcMain } = require('electron')
const yas = require('youtube-audio-server')

// Listen for `download` message from renderer.
ipcMain.on('download', (event, id) => {
  console.log(`DOWNLOAD ${id}`)
  download(event, { id, onDone, onMetadata })
})

function onDone(event, { id, file, filename }) {
  console.log(`💾 ${id}`)
  console.log(`   ${file}`)
  event.reply('downloaded', { id, file, filename })
}

function onError(event, { id, file, error }) {
  event.reply('error', { id, file, error })
}

function onMetadata(event, metadata) {
  const { id, error } = metadata
  if (error) {
    console.error('Error getting metadata', error)
    return
  }

  console.log(`Got metadata for ${id}`, metadata?.title)
  event.reply('metadata', metadata)
}

function download(event, { id, onDone, onMetadata }) {
  yas.downloader
    .onSuccess(({ id, file, filename }) => {
      console.log(`Yay! Audio (${id}) downloaded successfully into "${file}"!`)
      onDone(event, { id, file, filename })
    })
    .onError(({ id, file, error }) => {
      console.error(`Sorry, an error ocurred when trying to download ${id}:`, error)
      onError(event, { id, file, error })
    })
    .onMetadata(metadata => {
      onMetadata(event, metadata)
    })
    .download({ id, cache: true, metadata: true })
}
