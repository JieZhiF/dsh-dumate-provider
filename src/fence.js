/**
 * Admission fence for the plugin's HTTP routes.
 *
 * The plugin registers `/api/dumate-provider`, which is longer than the
 * kernel's `/api` prefix. Web-server dispatch is longest-prefix-first, so these
 * routes run BEFORE the connection service's own admission check — without an
 * explicit fence they would answer any loopback caller, and these routes can
 * read account data and claim check-in rewards.
 *
 * Two layers, tried in order:
 *   1. the composition's own `connection` service, when present — the exact
 *      decision the kernel applies to its `/api` routes, so the plugin is never
 *      weaker than the app;
 *   2. a structural replica for compositions without it: loopback Host only,
 *      no cross-site fetch, and an Origin/Referer that matches the Host.
 *
 * @module src/fence
 */

/** Hostnames a same-machine caller can legitimately use. */
const LOOPBACK = new Set(['127.0.0.1', '[::1]', '::1', 'localhost'])

/** Split a Host/Origin/Referer value into scheme + hostname + port. */
function authorityOf(value, defaultScheme = 'http') {
  if (typeof value !== 'string' || value.trim() === '') return null
  let url
  try {
    url = new URL(value.includes('://') ? value.trim() : `${defaultScheme}://${value.trim()}`)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const port = url.port === '' ? (url.protocol === 'https:' ? '443' : '80') : url.port
  return { scheme: url.protocol.slice(0, -1), hostname: url.hostname.toLowerCase(), port }
}

/** The replica check; returns a fixed reason or undefined when admitted. */
function structuralReason(req) {
  const host = authorityOf(req.headers.host, 'http')
  if (host === null || !LOOPBACK.has(host.hostname)) return 'host-not-loopback'
  const site = String(req.headers['sec-fetch-site'] ?? '').toLowerCase()
  if (site === 'cross-site') return 'cross-site'
  for (const header of ['origin', 'referer']) {
    const raw = req.headers[header]
    if (typeof raw !== 'string' || raw.trim() === '') continue
    // The desktop shell relays page requests with `dsh-app://app` as Referer
    // and strips the browser markers; that is the owned page, not a foreign one.
    if (header === 'referer' && isDesktopRelay(raw)) {
      if (req.headers.origin !== undefined || req.headers['sec-fetch-site'] !== undefined) return 'desktop-relay-markers'
      continue
    }
    const authority = authorityOf(raw.trim())
    if (authority === null) return `${header}-invalid`
    if (authority.scheme !== host.scheme || authority.hostname !== host.hostname || authority.port !== host.port) {
      return `${header}-mismatch`
    }
  }
  return undefined
}

function isDesktopRelay(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'dsh-app:' && url.hostname === 'app' && url.port === ''
  } catch {
    return false
  }
}

/**
 * Build the per-request admission decision.
 *
 * @param {() => object|undefined} connection - resolves the live `connection`
 *   service, if the composition mounts one.
 * @param {(event:object) => void} [onRejection] - fixed diagnostics only.
 * @returns {(req: import('node:http').IncomingMessage) => (number|undefined)}
 *   an HTTP status to reject with, or undefined to let the handler run.
 */
export function createRejection(connection, onRejection) {
  return function rejection(req) {
    let decision
    let service
    try {
      service = connection()
    } catch {
      service = undefined
    }
    try {
      const admit = service?.admit
      if (typeof admit === 'function') {
        const admission = admit.call(service, req)
        const status = admission !== null && typeof admission === 'object' ? admission.rejection : undefined
        if (status !== undefined) decision = { status, source: 'connection', reason: 'host-rejected' }
      } else if (typeof service?.requestRejection === 'function') {
        // Hosts before the `admit` spelling publish the same decision here.
        const status = service.requestRejection.call(service, req)
        if (status !== undefined) decision = { status, source: 'connection', reason: 'host-rejected' }
      }
    } catch {
      // A mounted host service that throws must fail closed: never fall back to
      // the structural fence, which does not know about browser authentication.
      decision = { status: 503, source: 'connection', reason: 'admission-error' }
    }
    if (decision === undefined) {
      const reason = structuralReason(req)
      if (reason !== undefined) decision = { status: 403, source: 'structural', reason }
    }
    if (decision === undefined) return undefined
    try {
      onRejection?.(decision)
    } catch {
      // Diagnostics are observational.
    }
    return decision.status
  }
}
