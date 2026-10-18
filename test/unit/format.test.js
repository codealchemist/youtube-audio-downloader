import fs from 'node:fs'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

const context = {}
context.globalThis = context
vm.runInNewContext(fs.readFileSync(new URL('../../src/renderer/format.js', import.meta.url), 'utf8'), context)
const {
  formatBytes, formatProgress, missingToolsMessage, formatTime, formatDate, songDetails, jobStatus,
  jobPercent, addResultMessage, hueFor, initial, matchesSearch, sortSongs
} = context.yasFormat

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

describe('formatTime', () => {
  it.each([
    [0, '0:00'],
    [7.9, '0:07'],
    [187, '3:07'],
    [3723, '1:02:03'],
    [NaN, '0:00'],
    [Infinity, '0:00'],
    [-1, '0:00']
  ])('%d seconds is %s', (seconds, text) => {
    expect(formatTime(seconds)).toBe(text)
  })
})

describe('songDetails', () => {
  const now = new Date(2026, 9, 18).getTime()

  it('joins artist, size and date', () => {
    const song = { artist: 'Band', size: 4.2 * 1024 * 1024, modified: new Date(2026, 9, 17).getTime() }
    expect(songDetails(song, now)).toBe('Band · 4.2 MB · Oct 17')
  })

  it('adds the year for older songs and leaves out what is missing', () => {
    expect(songDetails({ artist: '', size: 512, modified: new Date(2024, 0, 2).getTime() }, now)).toBe('512 B · Jan 2, 2024')
    expect(formatDate('nope')).toBe('')
  })
})

describe('jobStatus and jobPercent', () => {
  it.each([
    [{ status: 'queued' }, 'Waiting'],
    [{ status: 'starting' }, 'Looking up the video…'],
    [{ status: 'downloading', downloaded: 1024, total: 4096 }, '1.0 KB of 4.0 KB (25%)'],
    [{ status: 'downloading', downloaded: 0, total: 0 }, '0 B'],
    [{ status: 'done' }, 'Saved to your library'],
    [{ status: 'failed', error: 'Video unavailable' }, 'Video unavailable'],
    [{ status: 'failed' }, 'The download failed.'],
    [{ status: 'weird' }, '']
  ])('%j reads %j', (job, text) => {
    expect(jobStatus(job)).toBe(text)
  })

  it('computes the percent downloaded', () => {
    expect(jobPercent({ downloaded: 50, total: 200 })).toBe(25)
    expect(jobPercent({ downloaded: 300, total: 200 })).toBe(100)
    expect(jobPercent({ downloaded: 50, total: 0 })).toBe(0)
    expect(jobPercent()).toBe(0)
  })
})

describe('addResultMessage', () => {
  it('is empty when everything was added', () => {
    expect(addResultMessage({ added: 3, invalid: 0, duplicates: 0, full: 0 })).toBe('')
  })

  it('explains what was skipped', () => {
    expect(addResultMessage({ invalid: 1 })).toBe('That is not a YouTube link or video id.')
    expect(addResultMessage({ invalid: 2, duplicates: 1 })).toBe('2 entries are not YouTube links or video ids. That video is already in the queue.')
    expect(addResultMessage({ duplicates: 3, full: 1 })).toBe('3 videos are already in the queue. The queue is full. Wait for some downloads to finish.')
  })
})

describe('covers without art', () => {
  it('get a stable hue and an initial', () => {
    expect(hueFor('Song')).toBe(hueFor('Song'))
    expect(hueFor('Song')).toBeGreaterThanOrEqual(0)
    expect(hueFor('Song')).toBeLessThan(360)
    expect(initial('  (the) song')).toBe('T')
    expect(initial('ñu')).toBe('Ñ')
    expect(initial('!!!')).toBe('♪')
  })
})

describe('matchesSearch and sortSongs', () => {
  const songs = [
    { title: 'Track 10', artist: 'Band', album: '', modified: 3 },
    { title: 'track 2', artist: 'Other', album: 'Live', modified: 1 },
    { title: 'Another', artist: 'Band', album: '', modified: 2 }
  ]

  it('matches every word against title, artist and album', () => {
    expect(songs.filter(song => matchesSearch(song, 'band')).map(song => song.title)).toEqual(['Track 10', 'Another'])
    expect(songs.filter(song => matchesSearch(song, 'TRACK live')).map(song => song.title)).toEqual(['track 2'])
    expect(songs.filter(song => matchesSearch(song, '  ')).length).toBe(3)
  })

  it('sorts newest first or by name, without changing the list', () => {
    expect(sortSongs(songs, 'newest').map(song => song.modified)).toEqual([3, 2, 1])
    expect(sortSongs(songs, 'name').map(song => song.title)).toEqual(['Another', 'track 2', 'Track 10'])
    expect(songs[0].title).toBe('Track 10')
  })
})
