// Downloads waiting their turn. The download service runs one at a time, so
// the queue hands it the next video when the previous one finishes, and
// reports every change so the window can show each item's status.
import path from 'node:path'
import { userMessage } from './download-service.js'

// Bounds what the window can ask for in one go.
export const MAX_INPUT_LENGTH = 20000
export const MAX_ITEMS = 200
// Progress arrives many times a second; the window doesn't need all of it.
const PROGRESS_INTERVAL_MS = 200

// Waiting, looking up the video, downloading, saved, or failed.
export const STATUS = {
  QUEUED: 'queued',
  STARTING: 'starting',
  DOWNLOADING: 'downloading',
  DONE: 'done',
  FAILED: 'failed'
}

const isActive = item => item.status === STATUS.STARTING || item.status === STATUS.DOWNLOADING
const isPending = item => item.status === STATUS.QUEUED || isActive(item)

// Links can be pasted one per line, or separated by spaces or commas.
export function splitInput (text) {
  if (typeof text !== 'string') return []
  return text.slice(0, MAX_INPUT_LENGTH).split(/[\s,]+/).filter(Boolean)
}

export function createQueue ({ service, parseVideoId, onChange = () => {}, onSaved = () => {}, now = Date.now }) {
  let items = []
  let nextKey = 1
  let running = false
  let lastProgress = 0

  const snapshot = () => items.map(item => ({ ...item }))
  const changed = () => onChange(snapshot())

  // Returns how many were added, and how many entries were skipped because
  // they aren't YouTube videos, are already waiting, or the queue is full.
  function add (text) {
    const result = { added: 0, invalid: 0, duplicates: 0, full: 0 }
    for (const entry of splitInput(text)) {
      const id = parseVideoId(entry)
      if (!id) {
        result.invalid++
      } else if (items.some(item => item.id === id && isPending(item))) {
        result.duplicates++
      } else if (items.length >= MAX_ITEMS) {
        result.full++
      } else {
        items.push({ key: String(nextKey++), id, status: STATUS.QUEUED, title: '', downloaded: 0, total: 0, error: '', name: '' })
        result.added++
      }
    }
    if (result.added) {
      changed()
      run()
    }
    return result
  }

  async function run () {
    if (running) return
    running = true
    let item
    while ((item = items.find(entry => entry.status === STATUS.QUEUED))) {
      await downloadItem(item)
    }
    running = false
  }

  async function downloadItem (item) {
    item.status = STATUS.STARTING
    changed()
    try {
      const result = await service.download(item.id, {
        onMetadata: ({ title }) => {
          item.title = title || ''
          changed()
        },
        onProgress: ({ downloaded, total }) => {
          item.status = STATUS.DOWNLOADING
          item.downloaded = Number(downloaded) || 0
          item.total = Number(total) || 0
          if (now() - lastProgress < PROGRESS_INTERVAL_MS) return
          lastProgress = now()
          changed()
        }
      })
      item.status = STATUS.DONE
      item.name = path.basename(result.file)
      if (!item.title) item.title = result.filename || item.id
      onSaved(item.name)
    } catch (error) {
      item.status = STATUS.FAILED
      item.error = userMessage(error)
    }
    changed()
  }

  const find = key => items.find(item => item.key === key)

  // Items being downloaded can't be removed: yt-dlp can't be stopped midway.
  function remove (key) {
    const item = find(key)
    if (!item || isActive(item)) return false
    items = items.filter(entry => entry !== item)
    changed()
    return true
  }

  function retry (key) {
    const item = find(key)
    if (item?.status !== STATUS.FAILED) return false
    Object.assign(item, { status: STATUS.QUEUED, error: '', downloaded: 0, total: 0 })
    changed()
    run()
    return true
  }

  function clearFinished () {
    items = items.filter(item => item.status !== STATUS.DONE)
    changed()
  }

  return { add, remove, retry, clearFinished, items: snapshot }
}
