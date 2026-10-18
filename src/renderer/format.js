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

  root.yasFormat = { formatBytes, formatProgress, missingToolsMessage }
})(globalThis)
