/**
 * Host half of the phone file bridge.
 *
 * Starts a small LAN listener for the phone page and uploads, and registers the
 * loopback-only JSON/byte routes that the Web client half consumes. DSH's own
 * web server (and therefore the GUI) keeps its existing bind and auth policy.
 */

import net from 'node:net'
import os from 'node:os'
import { createBridge, normalizeToken } from './bridge.js'

const DEFAULTS = {
  port: 8787,
  bind: '',
  token: '',
  maxBytes: 20 * 1024 * 1024,
  keepFiles: true,
  retentionHours: 72,
}

const PRIVATE_RANGES = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/
/** Names of software adapters that a phone on the physical LAN can never reach. */
const VIRTUAL_ADAPTER =
  /vEthernet|VMware|VirtualBox|Hyper-V|WSL|Docker|Tailscale|ZeroTier|FlClash|Clash|Surge|Mihomo|Proxy|TUN\b|TAP\b|Loopback|Hamachi|Radmin|Bluetooth|Npcap|VPN/i
/** Names that usually belong to the adapter carrying the default route. */
const PHYSICAL_ADAPTER = /以太网|ethernet|wlan|wi-?fi|wireless|无线|本地连接|\bLAN\b/i
/** 198.18.0.0/15 is the benchmarking range proxy clients commonly take over. */
const BENCHMARK_RANGE = /^198\.(18|19)\./

function addressScore(candidate) {
  let score = 0
  if (PHYSICAL_ADAPTER.test(candidate.name)) score += 100
  if (/^192\.168\./.test(candidate.address)) score += 40
  else if (/^10\./.test(candidate.address)) score += 30
  else if (/^172\.(1[6-9]|2\d|3[01])\./.test(candidate.address)) score += 20
  if (candidate.mac && candidate.mac !== '00:00:00:00:00:00') score += 5
  return score
}

/**
 * Pick the address a phone on the same Wi-Fi should use. Virtual adapters from
 * Hyper-V, WSL, Docker, VPN/proxy clients are skipped, and physical adapters on
 * a private range win.
 */
export function detectLanAddress(networkInterfaces = os.networkInterfaces()) {
  const candidates = []
  for (const [name, addresses] of Object.entries(networkInterfaces ?? {})) {
    if (VIRTUAL_ADAPTER.test(name)) continue
    for (const entry of addresses ?? []) {
      const family = entry.family
      if (family !== 'IPv4' && family !== 4) continue
      if (entry.internal) continue
      if (BENCHMARK_RANGE.test(entry.address)) continue
      candidates.push({ name, address: entry.address, mac: entry.mac })
    }
  }
  const usable = candidates.filter((candidate) => PRIVATE_RANGES.test(candidate.address))
  const ranked = usable
    .map((candidate) => ({ candidate, score: addressScore(candidate) }))
    .sort((left, right) => right.score - left.score)
  return (ranked[0]?.candidate ?? candidates[0])?.address ?? '127.0.0.1'
}

function integer(value, fallback, minimum, maximum, label) {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`photo-bridge: "${label}" must be an integer between ${minimum} and ${maximum} (got ${String(value)})`)
  }
  return parsed
}

/** Validate the Loader row config and fill auto-detected values. */
export function resolveConfig(config) {
  const input = config && typeof config === 'object' ? config : {}
  const port = integer(input.port, DEFAULTS.port, 1, 65535, 'port')
  const maxBytes = integer(input.maxBytes, DEFAULTS.maxBytes, 256 * 1024, 200 * 1024 * 1024, 'maxBytes')
  const retentionHours = integer(input.retentionHours, DEFAULTS.retentionHours, 1, 24 * 365, 'retentionHours')
  const keepFiles = input.keepFiles === undefined ? DEFAULTS.keepFiles : input.keepFiles !== false

  let token = normalizeToken(input.token)
  if (typeof input.token === 'string' && input.token.trim() !== '' && token === '') {
    throw new Error('photo-bridge: "token" must be 16-64 lowercase hexadecimal characters')
  }

  let bind = typeof input.bind === 'string' ? input.bind.trim() : ''
  if (bind !== '') {
    if (net.isIP(bind) === 0) {
      throw new Error(`photo-bridge: "bind" must be a concrete IPv4/IPv6 address (got "${bind}")`)
    }
    if (bind === '0.0.0.0' || bind === '::' || bind === '0:0:0:0:0:0:0:0') {
      throw new Error('photo-bridge: "bind" must name one interface; 0.0.0.0/:: would expose the listener on every network')
    }
  } else {
    bind = detectLanAddress()
  }

  return { port, bind, token, maxBytes, keepFiles, retentionHours }
}

function loopbackHostname(hostname) {
  const host = hostname.toLowerCase()
  return host === 'localhost' || host === '::1' || host === '[::1]' || host === '127.0.0.1' || host.startsWith('127.')
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    'cache-control': 'no-store',
  })
  res.end(data)
}

/**
 * Read-only probe: report what the live LLM registry believes about the
 * currently selected model. The dock uses it to explain why a photo was
 * accepted into the draft but the selected model cannot read images.
 */
function registerModelProbe(ctx, webCtx) {
  webCtx.effect(
    () => webCtx.webServer.register({
      kind: 'exact',
      path: '/photo-bridge/model',
      handler: async (req, res) => {
        if (req.method !== 'GET') {
          sendJson(res, 405, { ok: false, code: 'METHOD' })
          return
        }
        const llm = ctx.get('llm')
        const defaults = ctx.get('agentDefaultModel')
        if (typeof llm?.resolveModelInfo !== 'function') {
          sendJson(res, 503, { ok: false, code: 'NO_LLM' })
          return
        }
        const selection = defaults?.currentSelection?.()
        if (!selection?.provider || !selection?.model) {
          sendJson(res, 503, { ok: false, code: 'NO_SELECTION' })
          return
        }
        try {
          const info = await llm.resolveModelInfo(selection.provider, selection.model)
          sendJson(res, 200, { ok: true, selection, info })
        } catch (error) {
          sendJson(res, 500, {
            ok: false,
            code: error?.code ?? 'ERROR',
            message: String(error?.message ?? error),
          })
        }
      },
    }),
    'photo-bridge: model probe',
  )
}

function registerClientRoutes(ctx, bridge) {
  ctx.inject(['webServer'], (webCtx) => {
    let originIsLoopback = true
    try {
      originIsLoopback = loopbackHostname(new URL(webCtx.webServer.getOrigin()).hostname)
    } catch {
      /* not bound yet: the shipped Web composition binds loopback, so keep going */
    }
    if (!originIsLoopback) {
      ctx.logger?.warn?.(
        'photo-bridge: the DSH web server is not bound to a loopback address; ' +
        'the attachment API routes were not registered to avoid exposing them to the network',
      )
      return
    }
    const routes = [
      { kind: 'exact', path: '/photo-bridge/config' },
      { kind: 'exact', path: '/photo-bridge/queue' },
      { kind: 'exact', path: '/photo-bridge/ack' },
      { kind: 'prefix', path: '/photo-bridge/item' },
    ]
    for (const route of routes) {
      webCtx.effect(
        () => webCtx.webServer.register({ ...route, handler: (req, res) => bridge.api(req, res) }),
        `photo-bridge: route ${route.path}`,
      )
    }
    registerModelProbe(ctx, webCtx)
  })
}

/** Cordis plugin entry. */
export async function apply(ctx, config) {
  const options = resolveConfig(config)
  const bridge = createBridge({ ...options, logger: ctx.logger })
  try {
    await bridge.listen()
  } catch (error) {
    await bridge.close()
    throw error
  }

  ctx.effect(() => () => bridge.close(), 'photo-bridge: listener')
  registerClientRoutes(ctx, bridge)

  if (options.bind.startsWith('127.') || options.bind === '::1') {
    ctx.logger?.warn?.(
      'photo-bridge: no LAN address detected; the phone cannot reach this computer. ' +
      'Connect Wi-Fi/Ethernet or set "bind" in the photo-bridge config.',
    )
  } else {
    ctx.logger?.info?.(`photo-bridge: phone listener ready on ${options.bind}:${options.port}`)
  }
}