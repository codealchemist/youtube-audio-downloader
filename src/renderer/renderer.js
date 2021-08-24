const { ipcRenderer } = require('electron')
console.log('Welcome!')

const $videoInput = document.querySelector('#video-input')
const $audio = document.querySelector('#audio')
const $metadata = document.querySelector('#metadata')
const $link = document.createElement('a')
const $loading = document.querySelector('#loading-container')

$videoInput.addEventListener('paste', (event) => {
  const id = event.clipboardData.getData('Text')
  console.log('DOWNLOAD', id)
  setLoading(true)
  setTitle('') // Reset title.
  ipcRenderer.send('download', id)
  setTimeout(() => $videoInput.blur())
})

ipcRenderer.on('downloaded', (event, data) => {
  console.log('DOWNLOADED', data)
  setLoading(false)
  const { id, file, filename } = data
  $audio.src = file
  $audio.play()
  $audio.style.opacity = 1;
  downloadFile({ file, filename })
})

ipcRenderer.on('metadata', (event, data) => {
  console.log('GOT METADATA', data)
  setTitle(data?.title)
})

ipcRenderer.on('error', (event, data) => {
  console.log('ERROR', data)
  setLoading(false)
  setTitle(`ERROR: ${data.error}`)
})

function setTitle(value) {
  $metadata.innerHTML = value
}

function setLoading(enabled) {
  if (enabled) {
    $loading.style.display = 'block'
    $loading.style.opacity = 1
  } else {
    $loading.style.display = 'none'
    $loading.style.opacity = 0
  }
}

function downloadFile({ file, filename }) {
  $link.href = file
  $link.setAttribute('download', filename)
  $link.click()
}
