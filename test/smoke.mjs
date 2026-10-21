/**
 * Standalone smoke test for the photo bridge core.
 *
 *   node test/smoke.mjs
 *
 * Starts the bridge on an ephemeral port in a throwaway data directory, then
 * exercises the phone page, upload validation, the queue/item/ack API, and the
 * retention-independent cleanup path.
 */

import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createBridge, sniffMedia } from '../bridge.js'
import { detectLanAddress } from '../index.js'
import { qrPath, qrSvg } from '../qr.js'

const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==',
  'base64',
)

let failures = 0
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`ok   ${name}`)
  } else {
    failures += 1
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'photo-bridge-test-'))
const token = '0123456789abcdef0123456789abcdef'
const bridge = createBridge({ port: 0, bind: '127.0.0.1', dataDir, token, maxBytes: 1024 * 1024 })
const phonePort = await bridge.listen()
const phoneBase = `http://127.0.0.1:${phonePort}`

const apiServer = http.createServer((req, res) => {
  bridge.api(req, res)
})
const apiPort = await listen(apiServer)
const apiBase = `http://127.0.0.1:${apiPort}`

try {
  const health = await fetch(`${phoneBase}/health`)
  check('health responds', health.ok && (await health.json()).ok === true)

  const page = await fetch(`${phoneBase}/p/${token}`)
  const html = await page.text()
  check('phone page served', page.ok && html.includes('拍照') && html.includes(token))
  check('phone page has CSP', String(page.headers.get('content-security-policy')).includes("default-src 'none'"))
  check('phone page has no external http', !/https?:\/\/(?!192\.168\.|127\.|localhost)/.test(html.replace(/http:\/\/192\.168\.1\.5:8787/g, '')))

  const badToken = await fetch(`${phoneBase}/p/${'f'.repeat(32)}`)
  check('wrong token is 404', badToken.status === 404)

  const landing = await fetch(`${phoneBase}/`)
  check('landing page served', landing.ok && (await landing.text()).includes('配对链接'))

  const upload = await fetch(`${phoneBase}/p/${token}/upload`, {
    method: 'POST',
    headers: { 'content-type': 'image/jpeg', 'x-filename': encodeURIComponent('IMG_0001.jpg') },
    body: JPEG,
  })
  const uploaded = await upload.json()
  check('jpeg upload accepted', upload.ok && uploaded.ok === true, JSON.stringify(uploaded))
  check('upload reports jpeg mime', uploaded.mime === 'image/jpeg')
  check('upload reports bytes', uploaded.bytes === JPEG.length)

  const junk = await fetch(`${phoneBase}/p/${token}/upload`, {
    method: 'POST',
    headers: { 'content-type': 'image/jpeg' },
    body: Buffer.from('not an image at all'),
  })
  const junkBody = await junk.json()
  check('junk body rejected', junk.status === 415 && junkBody.code === 'BAD_TYPE')

  const oversized = await fetch(`${phoneBase}/p/${token}/upload`, {
    method: 'POST',
    headers: { 'content-type': 'image/jpeg' },
    body: Buffer.alloc(1024 * 1024 + 1, 0xff),
  })
  check('oversized body rejected', oversized.status === 413, String(oversized.status))
  await oversized.text().catch(() => {})

  const config = await (await fetch(`${apiBase}/photo-bridge/config`)).json()
  check('config route', config.ok === true && config.token === token && config.loopback === true)
  check('config has no phone url on loopback', config.url === undefined)

  const queue = await (await fetch(`${apiBase}/photo-bridge/queue?since=0`)).json()
  check('queue contains one item', queue.ok === true && queue.items.length === 1, JSON.stringify(queue))
  const item = queue.items[0]
  check('queue keeps display name', item.name === 'IMG_0001.jpg')
  check('queue exposes no path', item.path === undefined)

  const bytes = await fetch(`${apiBase}/photo-bridge/item/${item.id}`)
  const downloaded = Buffer.from(await bytes.arrayBuffer())
  check('item bytes round-trip', bytes.ok && downloaded.equals(JPEG))
  check('item content-type is jpeg', bytes.headers.get('content-type') === 'image/jpeg')

  const ack = await fetch(`${apiBase}/photo-bridge/ack`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: item.id }),
  })
  check('ack succeeds', ack.ok && (await ack.json()).ok === true)

  const empty = await (await fetch(`${apiBase}/photo-bridge/queue?since=0`)).json()
  check('queue empty after ack', empty.items.length === 0)

  const secondAck = await fetch(`${apiBase}/photo-bridge/ack`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: item.id }),
  })
  check('second ack is 404', secondAck.status === 404)

  const forbidden = await fetch(`${apiBase}/photo-bridge/config`, {
    headers: { origin: 'https://example.com' },
  })
  check('cross-origin config is 403', forbidden.status === 403)

  check('sniff png', sniffMedia(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.mime === 'image/png')
  check('sniff webp', sniffMedia(Buffer.from('RIFFxxxxWEBP', 'ascii'))?.mime === 'image/webp')
  check(
    'sniff heic',
    sniffMedia(Buffer.concat([Buffer.from('00000000', 'hex'), Buffer.from('ftypheic', 'ascii'), Buffer.alloc(4)]))
      ?.mime === 'image/heic',
  )
  check('sniff rejects text', sniffMedia(Buffer.from('hello world!')) === undefined)

  const fakeAdapters = {
    'vEthernet (Default Switch)': [
      { address: '172.25.192.1', family: 'IPv4', internal: false, mac: '00:15:5d:e1:8b:50' },
    ],
    FlClash: [{ address: '198.18.0.1', family: 'IPv4', internal: false, mac: '00:00:00:00:00:00' }],
    '以太网': [{ address: '192.168.1.68', family: 'IPv4', internal: false, mac: '04:7c:16:d0:e2:10' }],
    'Loopback Pseudo-Interface 1': [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
  }
  check('bind detection skips virtual adapters', detectLanAddress(fakeAdapters) === '192.168.1.68', detectLanAddress(fakeAdapters))

  const pairing = `http://192.168.1.68:8787/p/${token}`
  const qr = qrPath(pairing)
  check('QR matrix is a valid size', qr.count >= 21 && qr.total === qr.count + 8, JSON.stringify({ count: qr.count, total: qr.total }))
  check('QR path covers modules', qr.path.startsWith('M') && qr.path.length > 100)
  const svg = qrSvg(pairing)
  check('QR SVG is standalone', svg.startsWith('<svg') && svg.includes('<path') && svg.includes('viewBox'))

  // The client receives the path, not the matrix; make sure every run lands on
  // the right module and that the quiet zone and finder patterns survive.
  const grid = Array.from({ length: qr.total }, () => Array(qr.total).fill(false))
  const runPattern = /M(\d+) (\d+)h(\d+)v1h-(\d+)z/g
  let run
  let filled = 0
  let runsValid = true
  while ((run = runPattern.exec(qr.path)) !== null) {
    const x = Number(run[1])
    const y = Number(run[2])
    const width = Number(run[3])
    if (Number(run[4]) !== width || width <= 0 || y >= qr.total || x + width > qr.total) {
      runsValid = false
      break
    }
    for (let offset = 0; offset < width; offset += 1) grid[y][x + offset] = true
    filled += width
  }
  check('QR path runs stay in bounds', runsValid && filled > 0)
  const finder = (top, left) => {
    for (let r = 0; r < 7; r += 1) {
      for (let c = 0; c < 7; c += 1) {
        const border = r === 0 || r === 6 || c === 0 || c === 6
        const core = r >= 2 && r <= 4 && c >= 2 && c <= 4
        if (grid[top + r][left + c] !== (border || core)) return false
      }
    }
    return true
  }
  check(
    'QR keeps three finder patterns and a quiet zone',
    finder(4, 4) &&
      finder(4, qr.total - 11) &&
      finder(qr.total - 11, 4) &&
      grid.slice(0, 4).every((row) => row.every((dark) => !dark)) &&
      grid.every((row) => row.slice(0, 4).every((dark) => !dark)),
  )

  const leakedName = await fetch(`${phoneBase}/p/${token}/upload`, {
    method: 'POST',
    headers: { 'content-type': 'image/jpeg', 'x-filename': encodeURIComponent('../../evil.jpg') },
    body: JPEG,
  })
  const leaked = await leakedName.json()
  check('path characters stripped from display name', leaked.ok && !leaked.name.includes('/') && !leaked.name.includes('\\'))

  const chineseName = await fetch(`${phoneBase}/p/${token}/upload`, {
    method: 'POST',
    headers: { 'content-type': 'image/jpeg', 'x-filename': encodeURIComponent('微信图片_2026.jpg') },
    body: JPEG,
  })
  const chinese = await chineseName.json()
  check('utf-8 display name accepted', chineseName.ok && chinese.name === '微信图片_2026.jpg', JSON.stringify(chinese))
  const chineseItem = await fetch(`${apiBase}/photo-bridge/item/${chinese.id}`)
  check('utf-8 display name does not break item headers', chineseItem.ok)
  await chineseItem.arrayBuffer()
  await fetch(`${apiBase}/photo-bridge/ack`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: chinese.id }),
  })

  const kept = await fs.readdir(path.join(dataDir, 'kept'))
  check('acked originals move out of inbox', kept.some((name) => name.endsWith('.jpg')), JSON.stringify(kept))

  const second = createBridge({ port: 0, bind: '127.0.0.1', dataDir, token, maxBytes: 1024 * 1024 })
  await second.listen()
  const secondServer = http.createServer((req, res) => {
    second.api(req, res)
  })
  const secondPort = await listen(secondServer)
  const restoredQueue = await (
    await fetch(`http://127.0.0.1:${secondPort}/photo-bridge/queue?since=0`)
  ).json()
  check(
    'restart restores only undelivered photos',
    restoredQueue.items.length === 1,
    JSON.stringify(restoredQueue.items.map((item) => item.name)),
  )
  await new Promise((resolve) => secondServer.close(resolve))
  await second.close()

  const stored = await fs.readdir(path.join(dataDir, 'inbox'))
  check('inbox stores browser-friendly files', stored.length >= 1 && stored.every((name) => /\.(jpg|png|webp|gif|heic)$/.test(name)))
} finally {
  await new Promise((resolve) => apiServer.close(resolve))
  await bridge.close()
  await fs.rm(dataDir, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`)
  process.exitCode = 1
} else {
  console.log('\nall checks passed')
}
