// Runs one download at a time through youtube-audio-server's downloader.
// The downloader keeps a single set of callbacks, so overlapping downloads
// would report to the wrong request; the window disables input meanwhile.
import { pathToFileURL } from 'node:url'

export const MESSAGES = {
  INVALID: 'That is not a YouTube link or video id.',
  BUSY: 'Another download is still running.',
  FAILED: 'The download failed.'
}

export class DownloadError extends Error {
  constructor (message) {
    super(message)
    this.name = 'DownloadError'
  }
}

// youtube-audio-server errors carry a message that is safe to show; anything
// else could contain paths or tool output, so it is replaced.
export function userMessage (error) {
  if (error?.name === 'YasError' || error instanceof DownloadError) return error.message
  return MESSAGES.FAILED
}

export function createDownloadService ({ downloader, parseVideoId, log = console }) {
  let running = false
  const files = new Set()

  function download (input, { onMetadata, onProgress } = {}) {
    const id = parseVideoId(input)
    if (!id) return Promise.reject(new DownloadError(MESSAGES.INVALID))
    if (running) return Promise.reject(new DownloadError(MESSAGES.BUSY))
    running = true

    return new Promise((resolve, reject) => {
      downloader
        .onSuccess(({ file, filename }) => {
          files.add(file)
          resolve({ id, file, filename, url: pathToFileURL(file).href })
        })
        .onError(({ error }) => {
          log.error(`Download of ${id} failed:`, error?.cause ?? error)
          reject(error)
        })
        .onMetadata(metadata => onMetadata?.({ id, title: metadata.title, artist: metadata.artist }))
        .onProgress(progress => onProgress?.({ id, ...progress }))
        .download({ id, metadata: true })
    }).finally(() => {
      running = false
    })
  }

  return {
    download,
    isBusy: () => running,
    // Only files this service saved may be revealed in the file manager.
    isDownloaded: file => files.has(file)
  }
}
