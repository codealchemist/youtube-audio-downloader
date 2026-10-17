import { describe, expect, it, vi } from 'vitest'
import { pathToFileURL } from 'node:url'
import { parseVideoId } from 'youtube-audio-server'
import { DownloadError, MESSAGES, createDownloadService, userMessage } from '../../src/main/download-service.js'

const ID = 'dQw4w9WgXcQ'

// Mimics youtube-audio-server's chainable downloader. `run` decides what
// happens when download() is called.
function fakeDownloader (run) {
  const callbacks = {}
  const downloader = {
    calls: [],
    onSuccess (cb) { callbacks.success = cb; return this },
    onError (cb) { callbacks.error = cb; return this },
    onMetadata (cb) { callbacks.metadata = cb; return this },
    onProgress (cb) { callbacks.progress = cb; return this },
    download (options) {
      this.calls.push(options)
      run(callbacks, options)
      return this
    }
  }
  return downloader
}

const quietLog = { error: () => {} }

describe('createDownloadService', () => {
  it('downloads a video and reports metadata and progress', async () => {
    const file = '/music/Song.mp3'
    const downloader = fakeDownloader((cb, { id }) => {
      cb.metadata({ id, title: 'Song', artist: 'Band', description: 'long text' })
      cb.progress({ downloaded: 10, total: 100, speed: 1, eta: 9 })
      cb.success({ id, file, filename: 'Song' })
    })
    const service = createDownloadService({ downloader, parseVideoId, log: quietLog })
    const onMetadata = vi.fn()
    const onProgress = vi.fn()

    const result = await service.download(`https://youtu.be/${ID}`, { onMetadata, onProgress })

    expect(result).toEqual({ id: ID, file, filename: 'Song', url: pathToFileURL(file).href })
    expect(downloader.calls).toEqual([{ id: ID, metadata: true }])
    expect(onMetadata).toHaveBeenCalledWith({ id: ID, title: 'Song', artist: 'Band' })
    expect(onProgress).toHaveBeenCalledWith({ id: ID, downloaded: 10, total: 100, speed: 1, eta: 9 })
    expect(service.isDownloaded(file)).toBe(true)
    expect(service.isDownloaded('/etc/passwd')).toBe(false)
    expect(service.isBusy()).toBe(false)
  })

  it.each(['', 'not a video', 'https://evil.example/watch?v=dQw4w9WgXcQ', `--exec=rm ${ID}`, null, 42])(
    'rejects invalid input %j without calling the downloader',
    async input => {
      const downloader = fakeDownloader(() => {})
      const service = createDownloadService({ downloader, parseVideoId, log: quietLog })
      await expect(service.download(input)).rejects.toMatchObject({ code: 'INVALID_ID', message: MESSAGES.INVALID })
      expect(downloader.calls).toHaveLength(0)
    }
  )

  it('allows one download at a time', async () => {
    let finish
    const downloader = fakeDownloader((cb, { id }) => { finish = () => cb.success({ id, file: '/m/a.mp3' }) })
    const service = createDownloadService({ downloader, parseVideoId, log: quietLog })

    const first = service.download(ID)
    expect(service.isBusy()).toBe(true)
    await expect(service.download(ID)).rejects.toMatchObject({ code: 'BUSY' })

    finish()
    await first
    expect(service.isBusy()).toBe(false)
  })

  it('rejects with the downloader error and frees the slot', async () => {
    const error = Object.assign(new Error('Video unavailable'), { name: 'YasError' })
    const downloader = fakeDownloader((cb, { id }) => cb.error({ id, error }))
    const service = createDownloadService({ downloader, parseVideoId, log: quietLog })

    await expect(service.download(ID)).rejects.toBe(error)
    expect(service.isBusy()).toBe(false)
  })
})

describe('userMessage', () => {
  it('shows youtube-audio-server and service messages', () => {
    expect(userMessage(Object.assign(new Error('Video unavailable'), { name: 'YasError' }))).toBe('Video unavailable')
    expect(userMessage(new DownloadError(MESSAGES.BUSY, 'BUSY'))).toBe(MESSAGES.BUSY)
  })

  it('hides other errors', () => {
    expect(userMessage(new Error('ENOENT: /Users/me/secret'))).toBe(MESSAGES.FAILED)
    expect(userMessage(undefined)).toBe(MESSAGES.FAILED)
  })
})
