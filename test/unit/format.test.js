import fs from 'node:fs'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

const context = {}
context.globalThis = context
vm.runInNewContext(fs.readFileSync(new URL('../../src/renderer/format.js', import.meta.url), 'utf8'), context)
const { formatBytes, formatProgress, missingToolsMessage } = context.yasFormat

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1536, '1.5 KB'],
    [5 * 1024 * 1024, '5.0 MB'],
    [3 * 1024 ** 4, '3072.0 GB']
  ])('%d bytes is %s', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text)
  })

  it('ignores unknown sizes', () => {
    expect(formatBytes(null)).toBe('')
    expect(formatBytes(-1)).toBe('')
  })
})

describe('formatProgress', () => {
  it('shows size and percentage', () => {
    expect(formatProgress({ downloaded: 1024 * 1024, total: 4 * 1024 * 1024 })).toBe('1.0 MB of 4.0 MB (25%)')
  })

  it('shows only the size when the total is unknown', () => {
    expect(formatProgress({ downloaded: 2048, total: null })).toBe('2.0 KB')
  })

  it('never goes past 100%', () => {
    expect(formatProgress({ downloaded: 200, total: 100 })).toBe('200 B of 100 B (100%)')
  })

  it('is empty without data', () => {
    expect(formatProgress()).toBe('')
  })
})

describe('missingToolsMessage', () => {
  it('explains missing required tools', () => {
    expect(missingToolsMessage({ required: ['yt-dlp'], optional: ['deno'] })).toBe('yt-dlp not found. Install it to download audio (see the README).')
    expect(missingToolsMessage({ required: ['yt-dlp', 'ffmpeg'] })).toMatch(/^yt-dlp and ffmpeg not found\. Install them/)
  })

  it('warns about optional tools', () => {
    expect(missingToolsMessage({ required: [], optional: ['deno'] })).toMatch(/^deno not found\. Some videos may fail/)
  })

  it('is empty when nothing is missing', () => {
    expect(missingToolsMessage({ required: [], optional: [] })).toBe('')
    expect(missingToolsMessage()).toBe('')
  })
})
