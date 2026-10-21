/**
 * Photo bridge core.
 *
 * Owns the LAN-facing HTTP listener, the upload queue, magic-number sniffing,
 * and the small JSON/byte API consumed by the Web client half through DSH's own
 * loopback web server. It has no dependency on Cordis or DSH types so the same
 * code can be exercised by a standalone smoke test.
 */

import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { phonePageHtml, landingPageHtml, expiredPageHtml, PHONE_BUILD } from './phone.html.js'
import { qrPath } from './qr.js'

const MAX_QUEUE = 20
const TOKEN_RE = /^[a-f0-9]{16,64}$/
const HTML_CSP =
  "default-src 'none'; img-src blob: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

/** Default data directory: the active profile when there is one, else `~/.dsh`. */
function defaultDataDir() {
  const base = process.env.DSH_PROFILE_DIR || path.join(os.homedir(), '.dsh')
  return path.join(base, 'photo-bridge')
}

function randomId() {
  return randomBytes(6).toString('hex')
}

export function createToken() {
  return randomBytes(16).toString('hex')
}

export function normalizeToken(value) {
  if (typeof value !== 'string') return ''
  const token = value.trim().toLowerCase()
  return TOKEN_RE.test(token) ? token : ''
}

/** Whether an address names this machine's own loopback interface. */
export function isLoopbackAddress(address) {
  if (typeof address !== 'string') return false
  const family = net.isIP(address)
  if (family === 4) return address.startsWith('127.')
  if (family === 6) {
    const normalized = address.toLowerCase()
    return normalized === '::1' || normalized === '0:0:0:0:0:0:0:1'
  }
  return false
}

function urlHost(address) {
  return net.isIP(address) === 6 ? `[${address}]` : address
}

/** Identify an image from its first bytes; the declared content-type is never trusted. */
export function sniffMedia(head) {
  if (!Buffer.isBuffer(head) || head.length < 3) return undefined
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' }
  }
  if (
    head.length >= 8 &&
    head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47 &&
    head[4] === 0x0d && head[5] === 0x0a && head[6] === 0x1a && head[7] === 0x0a
  ) {
    return { mime: 'image/png', ext: 'png' }
  }
  if (
    head.length >= 12 &&
    head.toString('ascii', 0, 4) === 'RIFF' &&
    head.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { mime: 'image/webp', ext: 'webp' }
  }
  if (head.length >= 6) {
    const signature = head.toString('ascii', 0, 6)
    if (signature === 'GIF87a' || signature === 'GIF89a') {
      return { mime: 'image/gif', ext: 'gif' }
    }
  }
  if (head.length >= 12 && head.toString('ascii', 4, 8) === 'ftyp') {
    const brand = head.toString('ascii', 8, 12)
    if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(brand)) {
      return { mime: 'image/heic', ext: 'heic' }
    }
  }
  return undefined
}

/** Constant-time comparison that still walks the full length. */
function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left))
  const b = Buffer.from(String(right))
  const length = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let index = 0; index < length; index += 1) {
    diff |= (a[index] ?? 0) ^ (b[index] ?? 0)
  }
  return diff === 0
}

function isLoopbackOrigin(origin) {
  try {
    const parsed = new URL(origin)
    const host = parsed.hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]' ||
      host.startsWith('127.')
  } catch {
    return false
  }
}

function originAllowed(req) {
  const origin = req.headers.origin
  if (typeof origin !== 'string' || origin === '') return true
  return isLoopbackOrigin(origin)
}

function displayName(raw, fallback) {
  if (typeof raw !== 'string' || raw === '') return fallback
  let value = raw
  try {
    value = decodeURIComponent(raw)
  } catch {
    /* keep the raw value */
  }
  value = value
    .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (value === '' || value === '.' || value === '..') return fallback
  return value.slice(0, 120)
}

/**
 * Create the bridge without opening any socket yet.
 *
 * @returns {{ token: string, listen: () => Promise<number>, close: () => Promise<void>,
 *   api: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>,
 *   config: () => object, queueSize: () => number, inboxDir: string, dataDir: string }}
 */
export function createBridge(options = {}) {
  const port = Number.isInteger(options.port) ? options.port : 8787
  const bind = typeof options.bind === 'string' && options.bind ? options.bind : '127.0.0.1'
  const maxBytes = Number.isInteger(options.maxBytes) ? options.maxBytes : 20 * 1024 * 1024
  const keepFiles = options.keepFiles !== false
  const retentionHours = Number.isFinite(options.retentionHours) ? options.retentionHours : 72
  const dataDir = typeof options.dataDir === 'string' && options.dataDir ? options.dataDir : defaultDataDir()
  const logger = options.logger
  const loopback = isLoopbackAddress(bind)

  const inboxDir = path.join(dataDir, 'inbox')
  const keptDir = path.join(dataDir, 'kept')
  const statePath = path.join(dataDir, 'state.json')

  try {
    fs.mkdirSync(inboxDir, { recursive: true })
    fs.mkdirSync(keptDir, { recursive: true })
  } catch (error) {
    throw new Error(`photo-bridge: cannot prepare data directory "${dataDir}": ${error.message}`)
  }

  /** @type {Map<string, { id: string, seq: number, name: string, mime: string, bytes: number, path: string, at: number }>} */
  const items = new Map()
  let seq = Date.now()
  let token = normalizeToken(options.token)
  let server
  let retentionTimer
  let closed = false
  /** Lightweight counters exposed on the config route so a running page is observable. */
  const stats = { polls: 0, acks: 0, uploads: 0, served: 0, lastPollAt: 0, lastPhoneUa: '', lastPhoneAt: 0 }
  /** The pairing URL is stable for the life of the listener, so the SVG is built once. */
  let qrCache = { url: '', svg: '' }

  function readState() {
    try {
      return JSON.parse(fs.readFileSync(statePath, 'utf8'))
    } catch {
      return {}
    }
  }

  function writeState() {
    const state = { ...readState(), token }
    const temporary = `${statePath}.${process.pid}.tmp`
    try {
      fs.writeFileSync(temporary, JSON.stringify(state, null, 2))
      fs.renameSync(temporary, statePath)
    } catch (error) {
      logger?.warn?.(`photo-bridge: cannot persist pairing token: ${error.message}`)
      try {
        fs.unlinkSync(temporary)
      } catch {
        /* ignore */
      }
    }
  }

  if (!token) {
    const stored = normalizeToken(readState().token)
    if (stored) token = stored
    else {
      token = createToken()
      writeState()
    }
  }

  function sendJson(res, status, body) {
    if (res.writableEnded || res.destroyed) return
    const payload = Buffer.from(JSON.stringify(body))
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(payload.length),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'cross-origin-resource-policy': 'same-origin',
    })
    res.end(payload)
  }

  function sendHtml(res, status, html) {
    if (res.writableEnded || res.destroyed) return
    const payload = Buffer.from(html)
    res.writeHead(status, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': String(payload.length),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'content-security-policy': HTML_CSP,
      'cross-origin-resource-policy': 'same-origin',
    })
    res.end(payload)
  }

  function publicItem(item) {
    return { id: item.id, seq: item.seq, name: item.name, mime: item.mime, bytes: item.bytes, at: item.at }
  }

  function dropItem(id) {
    const item = items.get(id)
    if (!item) return undefined
    items.delete(id)
    return item
  }

  async function removeFile(filePath) {
    try {
      await fsp.unlink(filePath)
    } catch {
      /* already gone */
    }
  }

  /**
   * Retire the bytes of an acknowledged item. Kept originals leave `inbox/` so
   * a restart never re-enqueues a photo that already reached a draft.
   */
  async function archiveItem(item) {
    if (!keepFiles) {
      await removeFile(item.path)
      return
    }
    try {
      await fsp.rename(item.path, path.join(keptDir, path.basename(item.path)))
    } catch {
      /* keep the original where it is */
    }
  }

  function enqueue(item) {
    items.set(item.id, item)
    while (items.size > MAX_QUEUE) {
      let oldest
      for (const candidate of items.values()) {
        if (!oldest || candidate.seq < oldest.seq) oldest = candidate
      }
      if (!oldest) break
      items.delete(oldest.id)
      void removeFile(oldest.path)
    }
  }

  function configPayload() {
    const baseUrl = loopback ? undefined : `http://${urlHost(bind)}:${port}`
    const url = baseUrl ? `${baseUrl}/p/${token}?v=${PHONE_BUILD}` : undefined
    const payload = {
      ok: true,
      v: 1,
      port,
      bind,
      token,
      loopback,
      url,
      maxBytes,
      queue: items.size,
      version: '1.0.0',
      stats: { ...stats },
    }
    if (url) {
      try {
        if (qrCache.url !== url) qrCache = { url, qr: qrPath(url) }
        payload.qr = qrCache.qr
      } catch (error) {
        logger?.warn?.(`photo-bridge: QR generation failed: ${error?.message ?? error}`)
      }
    }
    return payload
  }

  async function readJsonBody(req, limit) {
    let total = 0
    const chunks = []
    for await (const chunk of req) {
      total += chunk.length
      if (total > limit) return undefined
      chunks.push(chunk)
    }
    if (total === 0) return undefined
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      return undefined
    }
  }

  async function handleQueue(req, res) {
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, code: 'METHOD' })
      return
    }
    stats.polls += 1
    stats.lastPollAt = Date.now()
    const query = new URL(req.url ?? '/', 'http://photo-bridge.local').searchParams
    const raw = Number(query.get('since'))
    const since = Number.isFinite(raw) ? raw : 0
    const pending = [...items.values()]
      .filter((item) => item.seq > since)
      .sort((left, right) => left.seq - right.seq)
      .slice(0, MAX_QUEUE)
    let lastSeq = since
    for (const item of items.values()) if (item.seq > lastSeq) lastSeq = item.seq
    sendJson(res, 200, { ok: true, items: pending.map(publicItem), lastSeq })
  }

  async function handleItem(req, res, pathname) {
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, code: 'METHOD' })
      return
    }
    const id = pathname.slice('/photo-bridge/item/'.length)
    const item = items.get(id)
    if (!item) {
      sendJson(res, 404, { ok: false, code: 'NOT_FOUND' })
      return
    }
    let stat
    try {
      stat = await fsp.stat(item.path)
    } catch {
      dropItem(id)
      sendJson(res, 404, { ok: false, code: 'NOT_FOUND' })
      return
    }
    res.writeHead(200, {
      'content-type': item.mime,
      'content-length': String(stat.size),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'cross-origin-resource-policy': 'same-origin',
    })
    stats.served += 1
    const stream = fs.createReadStream(item.path)
    stream.on('error', () => {
      if (!res.headersSent) sendJson(res, 404, { ok: false, code: 'NOT_FOUND' })
      else res.destroy()
    })
    stream.pipe(res)
  }

  async function handleAck(req, res) {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, code: 'METHOD' })
      return
    }
    const body = await readJsonBody(req, 4096)
    const id = body && typeof body.id === 'string' ? body.id : ''
    const item = id ? dropItem(id) : undefined
    if (!item) {
      sendJson(res, 404, { ok: false, code: 'NOT_FOUND' })
      return
    }
    await archiveItem(item)
    stats.acks += 1
    sendJson(res, 200, { ok: true })
  }

  /** DSH-loopback routes consumed by the Web client half. */
  async function api(req, res) {
    try {
      if (!originAllowed(req)) {
        sendJson(res, 403, { ok: false, code: 'BAD_ORIGIN' })
        return
      }
      const url = new URL(req.url ?? '/', 'http://photo-bridge.local')
      const pathname = url.pathname
      if (pathname === '/photo-bridge/config') {
        if (req.method !== 'GET') {
          sendJson(res, 405, { ok: false, code: 'METHOD' })
          return
        }
        sendJson(res, 200, configPayload())
        return
      }
      if (pathname === '/photo-bridge/queue') {
        await handleQueue(req, res)
        return
      }
      if (pathname === '/photo-bridge/ack') {
        await handleAck(req, res)
        return
      }
      if (pathname === '/photo-bridge/item' || pathname.startsWith('/photo-bridge/item/')) {
        await handleItem(req, res, pathname)
        return
      }
      sendJson(res, 404, { ok: false, code: 'NOT_FOUND' })
    } catch (error) {
      logger?.warn?.(`photo-bridge: client API failed: ${error instanceof Error ? error.message : String(error)}`)
      if (!res.headersSent) sendJson(res, 500, { ok: false, code: 'INTERNAL' })
      else res.destroy()
    }
  }

  async function handleUpload(req, res) {
    const declared = Number(req.headers['content-length'])
    if (Number.isFinite(declared) && declared > maxBytes) {
      sendJson(res, 413, { ok: false, code: 'TOO_LARGE' })
      return
    }
    const chunks = []
    let head = Buffer.alloc(0)
    let total = 0
    let over = false
    try {
      for await (const chunk of req) {
        total += chunk.length
        if (total > maxBytes) {
          over = true
          if (total > maxBytes * 4) {
            req.destroy()
            return
          }
          continue
        }
        if (head.length < 16) {
          head = Buffer.concat([head, chunk.subarray(0, 16 - head.length)])
        }
        chunks.push(chunk)
      }
    } catch {
      if (!res.writableEnded) sendJson(res, 400, { ok: false, code: 'BAD_TYPE' })
      return
    }
    if (over) {
      sendJson(res, 413, { ok: false, code: 'TOO_LARGE' })
      return
    }
    if (total === 0) {
      sendJson(res, 415, { ok: false, code: 'BAD_TYPE' })
      return
    }
    const media = sniffMedia(head)
    if (!media) {
      sendJson(res, 415, { ok: false, code: 'BAD_TYPE' })
      return
    }
    const id = randomId()
    const at = Date.now()
    const diskName = `${at}-${id}.${media.ext}`
    const target = path.join(inboxDir, diskName)
    try {
      await fsp.writeFile(target, Buffer.concat(chunks), { flag: 'wx' })
    } catch (error) {
      logger?.warn?.(`photo-bridge: cannot store upload: ${error.message}`)
      sendJson(res, 500, { ok: false, code: 'WRITE_FAILED' })
      return
    }
    const name = displayName(req.headers['x-filename'], `photo-${id}.${media.ext}`)
    const item = { id, seq: ++seq, name, mime: media.mime, bytes: total, path: target, at }
    enqueue(item)
    stats.uploads += 1
    sendJson(res, 200, { ok: true, id, seq: item.seq, bytes: total, mime: media.mime, name })
  }

  async function handlePhone(req, res) {
    const url = new URL(req.url ?? '/', 'http://photo-bridge.local')
    const pathname = url.pathname
    if (req.method === 'GET' && pathname === '/health') {
      sendJson(res, 200, { ok: true, v: 1 })
      return
    }
    if (req.method === 'GET' && pathname === '/') {
      sendHtml(res, 200, landingPageHtml())
      return
    }
    const match = /^\/p\/([a-f0-9]{16,64})(\/upload)?$/.exec(pathname)
    if (!match) {
      sendJson(res, 404, { ok: false, code: 'NOT_FOUND' })
      return
    }
    if (!constantTimeEqual(match[1], token)) {
      if (req.method === 'GET' && !match[2]) sendHtml(res, 404, expiredPageHtml())
      else sendJson(res, 404, { ok: false, code: 'NOT_FOUND' })
      return
    }
    if (!match[2]) {
      if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, code: 'METHOD' })
        return
      }
      stats.lastPhoneUa = String(req.headers['user-agent'] ?? '').slice(0, 300)
      stats.lastPhoneAt = Date.now()
      sendHtml(res, 200, phonePageHtml(token))
      return
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, code: 'METHOD' })
      return
    }
    await handleUpload(req, res)
  }

  async function sniffFile(filePath) {
    let handle
    try {
      handle = await fsp.open(filePath, 'r')
      const head = Buffer.alloc(16)
      const { bytesRead } = await handle.read(head, 0, 16, 0)
      return sniffMedia(head.subarray(0, bytesRead))
    } catch {
      return undefined
    } finally {
      await handle?.close().catch(() => {})
    }
  }

  async function restoreInbox() {
    let names = []
    try {
      names = await fsp.readdir(inboxDir)
    } catch {
      return
    }
    const cutoff = Date.now() - retentionHours * 3600_000
    const restored = []
    for (const name of names.slice(0, 500)) {
      const full = path.join(inboxDir, name)
      let stat
      try {
        stat = await fsp.stat(full)
      } catch {
        continue
      }
      if (!stat.isFile()) continue
      if (stat.mtimeMs < cutoff) {
        await removeFile(full)
        continue
      }
      const media = await sniffFile(full)
      if (!media) continue
      restored.push({
        id: randomId(),
        seq: 0,
        name: `photo-${name.replace(/\.[^.]+$/, '')}.${media.ext}`,
        mime: media.mime,
        bytes: stat.size,
        path: full,
        at: stat.mtimeMs,
      })
    }
    restored.sort((left, right) => left.at - right.at)
    for (const item of restored.slice(-MAX_QUEUE)) {
      item.seq = ++seq
      items.set(item.id, item)
    }
  }

  async function cleanDirectory(directory, cutoff) {
    let names = []
    try {
      names = await fsp.readdir(directory)
    } catch {
      return
    }
    for (const name of names) {
      const full = path.join(directory, name)
      let stat
      try {
        stat = await fsp.stat(full)
      } catch {
        continue
      }
      if (stat.isFile() && stat.mtimeMs < cutoff) await removeFile(full)
    }
  }

  async function cleanup() {
    const cutoff = Date.now() - retentionHours * 3600_000
    for (const item of [...items.values()]) {
      if (item.at >= cutoff) continue
      items.delete(item.id)
      await removeFile(item.path)
    }
    await cleanDirectory(inboxDir, cutoff)
    await cleanDirectory(keptDir, cutoff)
  }

  async function listen() {
    if (server) return server.address()?.port ?? port
    await restoreInbox()
    const created = http.createServer((req, res) => {
      handlePhone(req, res).catch((error) => {
        logger?.warn?.(`photo-bridge: request failed: ${error instanceof Error ? error.message : String(error)}`)
        if (!res.headersSent) sendJson(res, 400, { ok: false, code: 'BAD_REQUEST' })
        else res.destroy()
      })
    })
    server = created
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        created.removeListener('listening', onListening)
        reject(new Error(
          `photo-bridge: cannot listen on ${bind}:${port} (${error.code || error.message}). ` +
          'Change "port" in the photo-bridge row of cordis.patch.yml, or stop the process using it.',
        ))
      }
      const onListening = () => {
        created.removeListener('error', onError)
        resolve()
      }
      created.once('error', onError)
      created.once('listening', onListening)
      created.listen(port, bind)
    })
    created.on('error', (error) => {
      logger?.warn?.(`photo-bridge: listener error: ${error.message}`)
    })
    retentionTimer = setInterval(() => {
      cleanup().catch((error) => logger?.warn?.(`photo-bridge: retention failed: ${error.message}`))
    }, 3600_000)
    retentionTimer.unref?.()
    return created.address()?.port ?? port
  }

  async function close() {
    if (closed) return
    closed = true
    if (retentionTimer) {
      clearInterval(retentionTimer)
      retentionTimer = undefined
    }
    if (!server) return
    const current = server
    server = undefined
    await new Promise((resolve) => {
      current.close(() => resolve())
      current.closeAllConnections?.()
    })
  }

  return {
    token,
    dataDir,
    inboxDir,
    api,
    listen,
    close,
    config: configPayload,
    queueSize: () => items.size,
  }
}