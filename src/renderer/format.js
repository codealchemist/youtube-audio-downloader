// Text helpers for the window. Plain script (no modules) so it works from a
// file:// page; tests load it in a VM context.
(function (root) {
  const UNITS = ['B', 'KB', 'MB', 'GB']

  function formatBytes (bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return ''
    let value = bytes
    let unit = 0
    while (value >= 1024 && unit < UNITS.length - 1) {
      value /= 1024
      unit++
    }
    return `${unit ? value.toFixed(1) : value} ${UNITS[unit]}`
  }

  // "1.2 MB of 4.0 MB (30%)", or just the downloaded size when the total is unknown.
  function formatProgress ({ downloaded, total } = {}) {
    const done = formatBytes(downloaded)
    if (!done) return ''
    if (!Number.isFinite(total) || total <= 0) return done
    const percent = Math.min(100, Math.round((downloaded / total) * 100))
    return `${done} of ${formatBytes(total)} (${percent}%)`
  }

  function missingToolsMessage ({ required = [], optional = [] } = {}) {
    if (required.length) {
      return `${required.join(' and ')} not found. Install ${required.length > 1 ? 'them' : 'it'} to download audio (see the README).`
    }
    if (optional.length) {
      return `${optional.join(' and ')} not found. Some videos may fail to download until it is installed (see the README).`
    }
    return ''
  }

  // "3:07", or "1:02:03" for an hour or more.
  function formatTime (seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
    const total = Math.floor(seconds)
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = String(total % 60).padStart(2, '0')
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
  }

  function formatDate (time, now = Date.now()) {
    const date = new Date(time)
    if (!Number.isFinite(date.getTime())) return ''
    const sameYear = date.getFullYear() === new Date(now).getFullYear()
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
  }

  // "Band · 4.2 MB · Oct 18"
  function songDetails (song, now) {
    return [song.artist, formatBytes(song.size), formatDate(song.modified, now)].filter(Boolean).join(' · ')
  }

  // What a download is doing, for the downloads list.
  function jobStatus (job) {
    switch (job.status) {
      case 'queued': return 'Waiting'
      case 'starting': return 'Looking up the video…'
      case 'downloading': return formatProgress(job) || 'Downloading…'
      case 'done': return 'Saved to your library'
      case 'failed': return job.error || 'The download failed.'
      default: return ''
    }
  }

  // Percent downloaded, or 0 when the size isn't known.
  function jobPercent ({ downloaded, total } = {}) {
    if (!Number.isFinite(downloaded) || !Number.isFinite(total) || total <= 0) return 0
    return Math.min(100, Math.max(0, Math.round((downloaded / total) * 100)))
  }

  const plural = (count, one, many) => (count === 1 ? one : many.replace('#', count))

  // Explains entries the queue skipped, or '' when everything was added.
  function addResultMessage ({ invalid = 0, duplicates = 0, full = 0 } = {}) {
    return [
      invalid && plural(invalid, 'That is not a YouTube link or video id.', '# entries are not YouTube links or video ids.'),
      duplicates && plural(duplicates, 'That video is already in the queue.', '# videos are already in the queue.'),
      full && 'The queue is full. Wait for some downloads to finish.'
    ].filter(Boolean).join(' ')
  }

  // A stable color for songs without a cover.
  function hueFor (text = '') {
    let hash = 0
    for (const char of String(text)) hash = (hash * 31 + char.codePointAt(0)) >>> 0
    return hash % 360
  }

  function initial (title = '') {
    const match = String(title).match(/[\p{L}\p{N}]/u)
    return match ? match[0].toUpperCase() : '♪'
  }

  function matchesSearch (song, query) {
    const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean)
    const text = [song.title, song.artist, song.album].join(' ').toLowerCase()
    return words.every(word => text.includes(word))
  }

  // Newest first, or by name.
  function sortSongs (songs, order) {
    const sorted = [...songs]
    if (order === 'name') return sorted.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }))
    return sorted.sort((a, b) => b.modified - a.modified)
  }

  root.yasFormat = {
    formatBytes,
    formatProgress,
    missingToolsMessage,
    formatTime,
    formatDate,
    songDetails,
    jobStatus,
    jobPercent,
    addResultMessage,
    hueFor,
    initial,
    matchesSearch,
    sortSongs
  }
})(globalThis)
