// The page has no Node access: it talks to the app through `window.yas`
// (src/preload/preload.cjs). Text from YouTube is only ever set as text.
const { formatProgress, missingToolsMessage } = window.yasFormat

const $videoInput = document.querySelector('#video-input')
const $audio = document.querySelector('#audio')
const $metadata = document.querySelector('#metadata')
const $progress = document.querySelector('#progress')
const $loading = document.querySelector('#loading-container')
const $folder = document.querySelector('#folder')
const $changeFolder = document.querySelector('#change-folder')
const $showFile = document.querySelector('#show-file')
const $warning = document.querySelector('#warning')

let lastFile = null
let folderWarning = null
let toolsWarning = ''

$videoInput.addEventListener('paste', event => {
  const text = event.clipboardData.getData('text')
  // Let the pasted text show in the input, then download it.
  setTimeout(() => download(text))
})

$videoInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') download($videoInput.value)
})

$changeFolder.addEventListener('click', async () => {
  const result = await window.yas.changeFolder()
  if (!result) return
  setFolder(result.folder)
  folderWarning = result.warning
  showWarning()
})

$showFile.addEventListener('click', () => {
  if (lastFile) window.yas.showFile(lastFile)
})

window.yas.onMetadata(data => setTitle(data?.title))
window.yas.onProgress(data => { $progress.textContent = formatProgress(data) })

async function download (input) {
  if (!input?.trim() || $videoInput.disabled) return
  setLoading(true)
  setTitle('')
  $progress.textContent = ''
  $showFile.hidden = true
  $videoInput.blur()

  try {
    const result = await window.yas.download(input.trim())
    if (!result.ok) {
      setTitle(`ERROR: ${result.error}`)
      return
    }
    lastFile = result.file
    if (!$metadata.textContent) setTitle(result.filename || result.id)
    $showFile.hidden = false
    $audio.src = result.url
    $audio.style.opacity = 1
    $audio.play().catch(() => {})
  } finally {
    setLoading(false)
    $videoInput.value = ''
  }
}

function setTitle (value) {
  $metadata.textContent = value || ''
}

function setFolder (folder) {
  $folder.textContent = folder
  $folder.title = folder
}

function setLoading (enabled) {
  $videoInput.disabled = enabled
  $changeFolder.disabled = enabled
  $loading.hidden = !enabled
}

function showWarning () {
  const warning = [folderWarning, toolsWarning].filter(Boolean).join(' ')
  $warning.textContent = warning
  $warning.hidden = !warning
}

window.yas.getState().then(state => {
  setFolder(state.folder)
  folderWarning = state.folderWarning
  toolsWarning = missingToolsMessage(state.missing)
  showWarning()
})
