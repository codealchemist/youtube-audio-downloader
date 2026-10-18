// The page has no Node access: it talks to the app through `window.yas`
// (src/preload/preload.cjs). Text from YouTube or file names is only ever
// set as text, never as HTML.
const {
  formatTime, songDetails, jobStatus, jobPercent, addResultMessage,
  missingToolsMessage, hueFor, initial, matchesSearch, sortSongs
} = window.yasFormat
const api = window.yas

const $ = selector => document.querySelector(selector)
const $input = $('#video-input')
const $addForm = $('#add-form')
const $folder = $('#folder')
const $changeFolder = $('#change-folder')
const $warning = $('#warning')
const $songs = $('#songs')
const $songsEmpty = $('#songs-empty')
const $songsEmptyText = $('#songs-empty-text')
const $songCount = $('#song-count')
const $search = $('#search')
const $sort = $('#sort')
const $queue = $('#queue')
const $queueEmpty = $('#queue-empty')
const $queueCount = $('#queue-count')
const $clearFinished = $('#clear-finished')
const $backdrop = $('#backdrop')
const $audio = $('#audio')
const $cover = $('#cover')
const $nowTitle = $('#now-title')
const $nowArtist = $('#now-artist')
const $play = $('#play')
const $prev = $('#prev')
const $next = $('#next')
const $seek = $('#seek')
const $timeCurrent = $('#time-current')
const $timeTotal = $('#time-total')
const $mute = $('#mute')
const $volume = $('#volume')
const $shareCurrent = $('#share-current')
const $toast = $('#toast')
const songTemplate = $('#song-template').content.firstElementChild
const jobTemplate = $('#job-template').content.firstElementChild

const state = {
  songs: [],
  jobs: [],
  current: null, // the song loaded in the player
  renaming: null, // name of the song being renamed
  seeking: false,
  folderWarning: null,
  toolsWarning: ''
}

// ---- Messages

let toastTimer = null
function toast (message, { error = false } = {}) {
  if (!message) return
  $toast.textContent = message
  $toast.classList.toggle('error', error)
  $toast.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { $toast.hidden = true }, 4500)
}

function showWarning () {
  const warning = [state.folderWarning, state.toolsWarning].filter(Boolean).join(' ')
  $warning.textContent = warning
  $warning.hidden = !warning
}

function setFolder (folder) {
  $folder.textContent = folder
  $folder.title = folder
}

// ---- Covers, read from the songs' ID3 tags and kept as blob URLs

const covers = new Map()

const coverKey = song => `${song.name}:${song.modified}`

function coverUrl (song) {
  if (!song?.hasCover) return Promise.resolve(null)
  const key = coverKey(song)
  if (!covers.has(key)) {
    covers.set(key, api.getCover(song.name).then(cover => {
      if (!cover?.data) return null
      return URL.createObjectURL(new Blob([cover.data], { type: cover.mime }))
    }).catch(() => null))
  }
  return covers.get(key)
}

function forgetCovers (songs) {
  const keep = new Set(songs.map(coverKey))
  for (const [key, url] of covers) {
    if (keep.has(key)) continue
    covers.delete(key)
    url.then(value => value && URL.revokeObjectURL(value))
  }
}

function setImage (element, url) {
  element.style.backgroundImage = url ? `url("${url}")` : ''
  element.classList.toggle('has-cover', Boolean(url))
}

// Thumbnails load as rows scroll into view.
const thumbObserver = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue
    thumbObserver.unobserve(entry.target)
    const song = findSong(entry.target.closest('.song')?.dataset.name)
    coverUrl(song).then(url => setImage(entry.target, url))
  }
}, { root: $songs, rootMargin: '200px' })

// ---- Library

const findSong = name => state.songs.find(song => song.name === name)

function visibleSongs () {
  return sortSongs(state.songs.filter(song => matchesSearch(song, $search.value)), $sort.value)
}

async function refreshSongs () {
  // Re-rendering would throw away a rename in progress.
  if (state.renaming) return
  state.songs = await api.listSongs()
  forgetCovers(state.songs)
  // Pick up new tags for the playing song, without reloading it.
  if (state.current) state.current = findSong(state.current.name) ?? state.current
  renderSongs()
}

function renderSongs () {
  const songs = visibleSongs()
  thumbObserver.disconnect()
  $songs.replaceChildren(...songs.map(songRow))
  $songCount.textContent = state.songs.length || ''
  $songsEmpty.hidden = songs.length > 0
  $songsEmptyText.textContent = state.songs.length
    ? 'No songs match your search.'
    : 'No songs yet. Paste a YouTube link above to save its audio here.'
  markPlaying()
}

function songRow (song) {
  const row = songTemplate.cloneNode(true)
  row.dataset.name = song.name
  row.style.setProperty('--hue', hueFor(song.title))
  row.querySelector('.song-title').textContent = song.title
  row.querySelector('.song-title').title = song.title
  row.querySelector('.song-meta').textContent = songDetails(song)
  row.querySelector('.thumb-letter').textContent = initial(song.title)
  if (song.hasCover) thumbObserver.observe(row.querySelector('.thumb'))
  return row
}

function markPlaying () {
  for (const row of $songs.children) {
    const playing = row.dataset.name === state.current?.name
    row.classList.toggle('playing', playing)
    row.classList.toggle('paused', playing && $audio.paused)
  }
}

$songs.addEventListener('click', event => {
  const row = event.target.closest('.song')
  if (!row || row.classList.contains('renaming')) return
  const action = event.target.closest('[data-action]')?.dataset.action
  const name = row.dataset.name
  if (action === 'rename') startRename(row)
  else if (action === 'share') share(name)
  else if (action === 'delete') remove(name)
  else if (event.target.closest('.song-main, .thumb')) playOrToggle(name)
})

$search.addEventListener('input', renderSongs)
$sort.addEventListener('change', renderSongs)

function startRename (row) {
  const song = findSong(row.dataset.name)
  if (!song) return
  state.renaming = song.name
  row.classList.add('renaming')

  const form = document.createElement('form')
  form.className = 'rename-form'
  const input = document.createElement('input')
  input.value = song.title
  input.setAttribute('aria-label', 'New name')
  input.spellcheck = false
  form.append(input)
  const main = row.querySelector('.song-main')
  main.hidden = true
  main.after(form)
  input.focus()
  input.select()

  let done = false
  const finish = async save => {
    if (done) return
    done = true
    const title = input.value.trim()
    let renamed = null
    if (save && title && title !== song.title) {
      const result = await api.renameSong(song.name, title)
      if (result.ok) renamed = result.name
      else toast(result.error, { error: true })
    }
    state.renaming = null
    await refreshSongs()
    if (renamed && state.current?.name === song.name) movePlayingSong(renamed)
  }

  form.addEventListener('submit', event => {
    event.preventDefault()
    finish(true)
  })
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') finish(false)
  })
  input.addEventListener('blur', () => finish(true))
}

async function share (name) {
  const result = await api.shareSong(name)
  if (!result.ok) toast(result.error, { error: true })
}

async function remove (name) {
  const result = await api.deleteSong(name)
  if (!result.ok) return toast(result.error, { error: true })
  if (result.deleted && state.current?.name === name) unload()
}

// ---- Downloads

$addForm.addEventListener('submit', event => {
  event.preventDefault()
  addToQueue($input.value, { keepInvalid: true })
})

// Pasting adds right away. The text shows in the input first.
$input.addEventListener('paste', event => {
  const text = event.clipboardData.getData('text')
  setTimeout(() => addToQueue(text))
})

async function addToQueue (text, { keepInvalid = false } = {}) {
  if (!text?.trim()) return
  const result = await api.addToQueue(text)
  const message = addResultMessage(result)
  if (message) toast(message, { error: !result.added })
  // Keep a typed entry that wasn't added, so it can be corrected.
  if (result.added || !keepInvalid) $input.value = ''
}

api.onQueueChanged(renderQueue)

function renderQueue (jobs) {
  state.jobs = jobs
  const rows = new Map([...$queue.children].map(row => [row.dataset.key, row]))
  const ordered = jobs.map(job => {
    const row = rows.get(job.key) ?? jobRow(job)
    updateJobRow(row, job)
    rows.delete(job.key)
    return row
  })
  for (const row of rows.values()) row.remove()
  // Only move rows that are out of place, so focus isn't lost.
  ordered.forEach((row, index) => {
    if ($queue.children[index] !== row) $queue.insertBefore(row, $queue.children[index] ?? null)
  })

  const pending = jobs.filter(job => ['queued', 'starting', 'downloading'].includes(job.status)).length
  $queueCount.textContent = pending || ''
  $queueEmpty.hidden = jobs.length > 0
  $clearFinished.hidden = !jobs.some(job => job.status === 'done')
  // The folder can't change under a running download.
  $changeFolder.disabled = jobs.some(job => job.status === 'starting' || job.status === 'downloading')
}

function jobRow (job) {
  const row = jobTemplate.cloneNode(true)
  row.dataset.key = job.key
  return row
}

function updateJobRow (row, job) {
  row.dataset.status = job.status
  row.dataset.name = job.name
  const title = job.title || job.id
  row.querySelector('.job-title').textContent = title
  row.querySelector('.job-title').title = title
  row.querySelector('.job-status').textContent = jobStatus(job)
  if (job.status === 'downloading') row.querySelector('.bar-fill').style.width = `${jobPercent(job)}%`
}

$queue.addEventListener('click', async event => {
  const row = event.target.closest('.job')
  const action = event.target.closest('[data-action]')?.dataset.action
  if (!row || !action) return
  if (action === 'remove') api.removeFromQueue(row.dataset.key)
  else if (action === 'retry') api.retryDownload(row.dataset.key)
  else if (action === 'play') {
    if (!findSong(row.dataset.name)) await refreshSongs()
    if (findSong(row.dataset.name)) play(row.dataset.name)
    else toast('That song is no longer in the folder.', { error: true })
  }
})

$clearFinished.addEventListener('click', () => api.clearFinished())

// ---- Player

function play (name) {
  const song = findSong(name)
  if (!song) return
  state.current = song
  $audio.src = song.url
  $audio.play().catch(() => {})
  showNowPlaying()
}

function playOrToggle (name) {
  if (state.current?.name === name) togglePlay()
  else play(name)
}

function togglePlay () {
  if (!state.current) {
    const [first] = visibleSongs()
    if (first) play(first.name)
    return
  }
  if ($audio.paused) $audio.play().catch(() => {})
  else $audio.pause()
}

function step (offset) {
  const songs = visibleSongs()
  if (!songs.length) return
  const index = songs.findIndex(song => song.name === state.current?.name)
  const target = index === -1 ? 0 : index + offset
  if (target < 0 || target >= songs.length) return false
  play(songs[target].name)
  return true
}

function previous () {
  // Like most players: restart the song unless it just started.
  if ($audio.currentTime > 3) $audio.currentTime = 0
  else if (!step(-1)) $audio.currentTime = 0
}

// After a rename the file has a new URL; carry on from the same spot.
function movePlayingSong (newName) {
  const song = findSong(newName)
  if (!song) return
  const wasPlaying = !$audio.paused
  const time = $audio.currentTime
  state.current = song
  $audio.src = song.url
  $audio.addEventListener('loadedmetadata', () => {
    $audio.currentTime = time
    if (wasPlaying) $audio.play().catch(() => {})
  }, { once: true })
  showNowPlaying()
}

function unload () {
  state.current = null
  $audio.pause()
  $audio.removeAttribute('src')
  $audio.load()
  showNowPlaying()
}

async function showNowPlaying () {
  const song = state.current
  $nowTitle.textContent = song?.title ?? 'Nothing playing'
  $nowTitle.title = song?.title ?? ''
  $nowArtist.textContent = song?.artist ?? ''
  $shareCurrent.disabled = !song
  document.title = song ? `${song.title} · YouTube Audio Downloader` : 'YouTube Audio Downloader'
  document.body.style.setProperty('--hue', hueFor(song?.title ?? ''))
  markPlaying()
  updateTransport()

  const url = await coverUrl(song)
  if (state.current !== song) return
  setImage($cover, url)
  setImage($backdrop, url)
  updateMediaSession(song, url)
}

function updateTransport () {
  const loaded = Boolean(state.current)
  const duration = Number.isFinite($audio.duration) ? $audio.duration : 0
  $play.querySelector('use').setAttribute('href', $audio.paused ? '#i-play' : '#i-pause')
  $play.setAttribute('aria-label', $audio.paused ? 'Play' : 'Pause')
  $play.title = $play.getAttribute('aria-label')
  $seek.disabled = !loaded
  $seek.max = duration
  if (!state.seeking) $seek.value = $audio.currentTime
  $seek.style.setProperty('--progress', `${duration ? ($seek.value / duration) * 100 : 0}%`)
  $timeCurrent.textContent = formatTime(Number($seek.value))
  $timeTotal.textContent = formatTime(duration)
}

$seek.addEventListener('input', () => {
  state.seeking = true
  updateTransport()
})
$seek.addEventListener('change', () => {
  $audio.currentTime = Number($seek.value)
  state.seeking = false
})

$play.addEventListener('click', togglePlay)
$prev.addEventListener('click', previous)
$next.addEventListener('click', () => step(1))
$shareCurrent.addEventListener('click', () => state.current && share(state.current.name))

$audio.addEventListener('timeupdate', updateTransport)
$audio.addEventListener('durationchange', updateTransport)
for (const type of ['play', 'pause']) {
  $audio.addEventListener(type, () => {
    updateTransport()
    markPlaying()
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = $audio.paused ? 'paused' : 'playing'
  })
}
$audio.addEventListener('ended', () => {
  if (!step(1)) updateTransport()
})
$audio.addEventListener('error', () => {
  if (state.current) toast(`Couldn't play “${state.current.title}”.`, { error: true })
})

function updateVolume () {
  const muted = $audio.muted || $audio.volume === 0
  $mute.querySelector('use').setAttribute('href', muted ? '#i-mute' : '#i-volume')
  $mute.setAttribute('aria-label', muted ? 'Unmute' : 'Mute')
  $volume.value = $audio.muted ? 0 : $audio.volume
  $volume.style.setProperty('--progress', `${$volume.value * 100}%`)
}

$volume.addEventListener('input', () => {
  $audio.volume = Number($volume.value)
  $audio.muted = false
})
$mute.addEventListener('click', () => { $audio.muted = !$audio.muted })
$audio.addEventListener('volumechange', updateVolume)

// Media keys and the system's "now playing" controls.
function updateMediaSession (song, artwork) {
  if (!('mediaSession' in navigator)) return
  navigator.mediaSession.metadata = song
    ? new window.MediaMetadata({ title: song.title, artist: song.artist, album: song.album, artwork: artwork ? [{ src: artwork }] : [] })
    : null
}

if ('mediaSession' in navigator) {
  const actions = {
    play: () => $audio.play().catch(() => {}),
    pause: () => $audio.pause(),
    previoustrack: previous,
    nexttrack: () => step(1),
    seekto: ({ seekTime }) => { $audio.currentTime = seekTime }
  }
  for (const [action, handler] of Object.entries(actions)) {
    try {
      navigator.mediaSession.setActionHandler(action, handler)
    } catch {}
  }
}

// Space plays and pauses, unless typing or on a control that uses it.
document.addEventListener('keydown', event => {
  if (event.key !== ' ' || event.repeat) return
  if (event.target.closest('input, select, button, textarea, [contenteditable]')) return
  event.preventDefault()
  togglePlay()
})

// ---- Folder

$changeFolder.addEventListener('click', async () => {
  const result = await api.changeFolder()
  if (!result) return
  setFolder(result.folder)
  state.folderWarning = result.warning
  showWarning()
  refreshSongs()
})

// ---- Start

api.onSongsChanged(refreshSongs)
// Files may have been added or removed outside the app.
window.addEventListener('focus', refreshSongs)

api.getState().then(appState => {
  $('#version').textContent = appState.version ? `v${appState.version}` : ''
  setFolder(appState.folder)
  state.folderWarning = appState.folderWarning
  state.toolsWarning = missingToolsMessage(appState.missing)
  showWarning()
})
api.getQueue().then(renderQueue)
refreshSongs()
updateTransport()
updateVolume()
