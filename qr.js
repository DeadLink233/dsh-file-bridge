/**
 * SVG QR code generation for the pairing URL.
 *
 * The encoder is a vendored copy of Kazuhiko Arase's MIT-licensed QRCode
 * implementation (see vendor/QRCode/LICENSE). It is byte-mode only, which is
 * all the pairing URL needs: the URL is ASCII (address, port, hex token).
 */

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const QRCode = require('./vendor/QRCode')

const MARGIN = 4
const ERROR_CORRECTION_M = 0

/**
 * Encode `text` and describe it as one SVG path in module coordinates.
 * The client turns this into inline `<svg>` elements, which avoids data URLs
 * and any dependency on the host page's `img-src` policy.
 *
 * @param {string} text
 * @param {{ margin?: number }} [options]
 * @returns {{ count: number, total: number, path: string }}
 */
export function qrPath(text, options = {}) {
  const value = String(text ?? '')
  if (value.length === 0) throw new Error('qrPath: empty input')
  const margin = options.margin ?? MARGIN

  const qr = new QRCode(0, ERROR_CORRECTION_M)
  qr.addData(value)
  qr.make()

  const count = qr.getModuleCount()
  const total = count + margin * 2
  let path = ''
  for (let row = 0; row < count; row += 1) {
    let col = 0
    while (col < count) {
      if (!qr.isDark(row, col)) {
        col += 1
        continue
      }
      const start = col
      while (col < count && qr.isDark(row, col)) col += 1
      const run = col - start
      path += `M${start + margin} ${row + margin}h${run}v1h-${run}z`
    }
  }
  return { count, total, path }
}

/**
 * Render the same code as a standalone SVG document (useful for tests and
 * for anything that cannot render inline SVG).
 * @param {string} text
 * @param {{ size?: number, margin?: number, dark?: string, light?: string }} [options]
 * @returns {string}
 */
export function qrSvg(text, options = {}) {
  const { total, path } = qrPath(text, { margin: options.margin })
  const size = options.size ?? 164
  const dark = options.dark ?? '#000000'
  const light = options.light ?? '#ffffff'
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" ` +
    `width="${size}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="QR">` +
    `<rect width="${total}" height="${total}" fill="${light}"/>` +
    `<path d="${path}" fill="${dark}"/>` +
    `</svg>`
  )
}