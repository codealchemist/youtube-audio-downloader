import { describe, expect, it, vi } from 'vitest'
import { parseVideoId } from 'youtube-audio-server'
import { DownloadError } from '../../src/main/download-service.js'
import { MAX_INPUT_LENGTH, MAX_ITEMS, STATUS, createQueue, splitInput } from '../../src/main/queue.js'

const A = 'aaaaaaaaaaa'
const B = 'bbbbbbbbbbb'
const C = 'ccccccccccc'

// A download service whose downloads finish when the test says so.
function fakeService () {
  const pending = []
  const service = {
    download: vi.fn((id, callbacks) => new Promise((resolve, reject) => {
      pending.push({ id, callbacks, resolve, reject })
    })),
    pending,
    finish (title = 'Song') {
      const job = pending.shift()
      job.callbacks.onMetadata({ id: job.id, title })
      job.resolve({ id: job.id, file: `/music/${title}.mp3`, filename: title })
    },
    fail (error) {
      pending.shift().reject(error)
    }
  }
  return service
}

const flush = () => new Promise(resolve => setTimeout(resolve))

function setup (options = {}) {
  const service = fakeService()
  const onChange = vi.fn()
  const onSaved = vi.fn()
  const queue = createQueue({ service, parseVideoId, onChange, onSaved, ...options })
  const statuses = () => queue.items().map(item => item.status)
  return { service, queue, onChange, onSaved, statuses }
}

describe('splitInput', () => {
  it('splits on lines, spaces and commas', () => {
    expect(splitInput(`${A}\nhttps://youtu.be/${B}, ${C}  \r\n`)).toEqual([A, `https://youtu.be/${B}`, C])
  })

  it('ignores anything but text, and very long input', () => {
    expect(splitInput(null)).toEqual([])
    expect(splitInput({ toString: () => A })).toEqual([])
    expect(splitInput(`${'x'.repeat(MAX_INPUT_LENGTH)} ${A}`)).toEqual(['x'.repeat(MAX_INPUT_LENGTH)])
  })
})

describe('createQueue', () => {
  it('downloads one video at a time, in order', async () => {
    const { service, queue, statuses, onSaved } = setup()
    expect(queue.add(`${A}\n${B}`)).toEqual({ added: 2, invalid: 0, duplicates: 0, full: 0 })
    expect(statuses()).toEqual([STATUS.STARTING, STATUS.QUEUED])
    expect(service.download).toHaveBeenCalledTimes(1)
    expect(service.download.mock.calls[0][0]).toBe(A)

    service.finish('First')
    await flush()
    expect(statuses()).toEqual([STATUS.DONE, STATUS.STARTING])
    expect(queue.items()[0]).toMatchObject({ id: A, title: 'First', name: 'First.mp3' })
    expect(onSaved).toHaveBeenCalledWith('First.mp3')

    service.finish('Second')
    await flush()
    expect(statuses()).toEqual([STATUS.DONE, STATUS.DONE])
    expect(service.download).toHaveBeenCalledTimes(2)
  })

  it('accepts links and gives each item its own key', () => {
    const { queue } = setup()
    queue.add(`https://www.youtube.com/watch?v=${A} https://youtu.be/${B}`)
    const items = queue.items()
    expect(items.map(item => item.id)).toEqual([A, B])
    expect(new Set(items.map(item => item.key)).size).toBe(2)
  })

  it('skips invalid entries and videos already waiting', () => {
    const { queue, onChange } = setup()
    expect(queue.add(`${A} ${A} not-a-video-id https://evil.example/watch?v=${B}`)).toEqual({ added: 1, invalid: 2, duplicates: 1, full: 0 })
    expect(queue.add('nope')).toEqual({ added: 0, invalid: 1, duplicates: 0, full: 0 })
    // Only the first add changed anything (the item, then it starting).
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('can download a video again once the first one is done', async () => {
    const { service, queue } = setup()
    queue.add(A)
    service.finish()
    await flush()
    expect(queue.add(A).added).toBe(1)
  })

  it('stops accepting videos when full', () => {
    const { queue } = setup()
    const ids = Array.from({ length: MAX_ITEMS + 2 }, (_, i) => `video${String(i).padStart(6, '0')}`)
    expect(queue.add(ids.join(' '))).toMatchObject({ added: MAX_ITEMS, full: 2 })
  })

  it('shows progress, but not every update', async () => {
    let time = 1000
    const { service, queue, onChange } = setup({ now: () => time })
    queue.add(A)
    const { callbacks } = service.pending[0]
    onChange.mockClear()

    callbacks.onProgress({ downloaded: 10, total: 100 })
    callbacks.onProgress({ downloaded: 20, total: 100 })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(queue.items()[0]).toMatchObject({ status: STATUS.DOWNLOADING, downloaded: 20, total: 100 })

    time += 500
    callbacks.onProgress({ downloaded: 50, total: 'NA' })
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(onChange.mock.lastCall[0][0]).toMatchObject({ downloaded: 50, total: 0 })
  })

  it('keeps going after a failure, with a message that is safe to show', async () => {
    const { service, queue, statuses } = setup()
    queue.add(`${A} ${B} ${C}`)
    service.fail(new DownloadError('Video unavailable'))
    await flush()
    service.fail(new Error('/private/path: exploded'))
    await flush()
    expect(statuses()).toEqual([STATUS.FAILED, STATUS.FAILED, STATUS.STARTING])
    expect(queue.items().map(item => item.error)).toEqual(['Video unavailable', 'The download failed.', ''])
  })

  it('retries failed downloads', async () => {
    const { service, queue, statuses } = setup()
    queue.add(A)
    service.fail(new DownloadError('Video unavailable'))
    await flush()
    const [{ key }] = queue.items()

    expect(queue.retry('nope')).toBe(false)
    expect(queue.retry(key)).toBe(true)
    expect(statuses()).toEqual([STATUS.STARTING])
    expect(queue.items()[0].error).toBe('')
    expect(queue.retry(key)).toBe(false)
  })

  it('removes items, except the one downloading', async () => {
    const { service, queue } = setup()
    queue.add(`${A} ${B}`)
    const [first, second] = queue.items()
    expect(queue.remove(first.key)).toBe(false)
    expect(queue.remove(second.key)).toBe(true)
    expect(queue.items().map(item => item.id)).toEqual([A])

    service.finish()
    await flush()
    // B was removed before its turn.
    expect(service.download).toHaveBeenCalledTimes(1)
    expect(queue.remove(first.key)).toBe(true)
    expect(queue.items()).toEqual([])
  })

  it('clears completed downloads only', async () => {
    const { service, queue, statuses } = setup()
    queue.add(`${A} ${B} ${C}`)
    service.finish('One')
    await flush()
    service.fail(new DownloadError('Video unavailable'))
    await flush()
    queue.clearFinished()
    expect(statuses()).toEqual([STATUS.FAILED, STATUS.STARTING])
  })

  it('hands out copies, so callers cannot change the queue', () => {
    const { queue, onChange } = setup()
    queue.add(A)
    queue.items()[0].status = STATUS.DONE
    onChange.mock.lastCall[0][0].id = B
    expect(queue.items()[0]).toMatchObject({ id: A, status: STATUS.STARTING })
  })
})
