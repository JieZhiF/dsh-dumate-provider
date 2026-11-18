/**
 * Minimal HTTPS client for the DuMate endpoints.
 *
 * Two shapes: one buffered JSON request, and one streamed request used for the
 * SSE chat lane. No proxy support, no retry policy and no redirect following
 * live here — the caller decides what a failure means, because the same HTTP
 * status means different things on the token, points and chat lanes.
 *
 * @module src/http
 */
import http from 'node:http'
import https from 'node:https'

const DEFAULT_TIMEOUT_MS = 20_000

/** Headers every DuMate web request sends; the site treats them as a browser. */
export function webHeaders(extra = {}) {
  return {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9',
    'x-dumate-client-type': 'web',
    referer: 'https://www.dumate.cn/app',
    origin: 'https://www.dumate.cn',
    ...extra,
  }
}

/**
 * Perform one request and buffer the body.
 *
 * @param {string} url - absolute https URL.
 * @param {object} [options]
 * @param {string} [options.method] - HTTP verb, default GET.
 * @param {Record<string,string>} [options.headers]
 * @param {string|Buffer} [options.body]
 * @param {number} [options.timeoutMs]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{status:number, headers:object, text:string, json:any, error?:string}>}
 *   `status` 0 means the request never produced a response (`error` says why).
 */
/** Pick the transport from the URL scheme, so a self-hosted http endpoint works too. */
function transportFor(url) {
  return url.startsWith('http://') ? http : https
}

export function requestText(url, options = {}) {
  return new Promise(resolve => {
    let settled = false
    const finish = value => {
      if (settled) return
      settled = true
      resolve(value)
    }
    let parsed
    try {
      parsed = new URL(url)
    } catch {
      finish({ status: 0, headers: {}, text: '', json: null, error: `invalid URL: ${url}` })
      return
    }
    const payload = options.body === undefined ? undefined : Buffer.from(options.body)
    const headers = { ...options.headers }
    if (payload !== undefined) {
      headers['content-length'] = String(payload.length)
      if (headers['content-type'] === undefined) headers['content-type'] = 'application/json'
    }
    const request = transportFor(url).request(
      {
        hostname: parsed.hostname,
        port: parsed.port === '' ? (parsed.protocol === 'http:' ? 80 : 443) : Number(parsed.port),
        path: `${parsed.pathname}${parsed.search}`,
        method: options.method ?? 'GET',
        headers,
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        signal: options.signal,
      },
      response => {
        const chunks = []
        let size = 0
        response.on('data', chunk => {
          size += chunk.length
          // Bounded read: a malformed upstream must not be able to grow the host heap.
          if (size > 4 * 1024 * 1024) {
            request.destroy(new Error('response too large'))
            return
          }
          chunks.push(chunk)
        })
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let json = null
          try {
            json = JSON.parse(text)
          } catch {
            json = null
          }
          finish({ status: response.statusCode ?? 0, headers: response.headers, text, json })
        })
        response.on('error', error => finish({ status: 0, headers: {}, text: '', json: null, error: error.message }))
      },
    )
    request.on('timeout', () => request.destroy(new Error('timeout')))
    request.on('error', error => finish({ status: 0, headers: {}, text: '', json: null, error: error.message }))
    if (payload !== undefined) request.write(payload)
    request.end()
  })
}

/**
 * Open a streamed response (SSE lane). Resolves as soon as response headers
 * arrive; the caller owns the response stream and must destroy it on abort.
 *
 * @param {string} url
 * @param {object} options - same fields as {@link requestText}
 * @returns {Promise<import('node:http').IncomingMessage>}
 * @throws {HttpStatusError} for a non-2xx status, carrying the buffered body.
 */
export function openStream(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const payload = options.body === undefined ? undefined : Buffer.from(options.body)
    const headers = { ...options.headers }
    if (payload !== undefined) {
      headers['content-length'] = String(payload.length)
      if (headers['content-type'] === undefined) headers['content-type'] = 'application/json'
    }
    const request = transportFor(url).request(
      {
        hostname: parsed.hostname,
        port: parsed.port === '' ? (parsed.protocol === 'http:' ? 80 : 443) : Number(parsed.port),
        path: `${parsed.pathname}${parsed.search}`,
        method: options.method ?? 'POST',
        headers,
        timeout: options.timeoutMs ?? 120_000,
        signal: options.signal,
      },
      response => {
        const status = response.statusCode ?? 0
        if (status < 200 || status >= 300) {
          const chunks = []
          response.on('data', chunk => chunks.push(chunk))
          response.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8')
            response.destroy()
            const error = new Error(`HTTP ${status}: ${body.slice(0, 400)}`)
            error.status = status
            error.body = body
            reject(error)
          })
          response.on('error', () => {
            const error = new Error(`HTTP ${status}: unreadable body`)
            error.status = status
            reject(error)
          })
          return
        }
        resolve(response)
      },
    )
    request.on('timeout', () => {
      const error = new Error('timeout')
      error.status = 0
      request.destroy(error)
      reject(error)
    })
    request.on('error', error => {
      if (error.status === undefined) error.status = 0
      reject(error)
    })
    if (payload !== undefined) request.write(payload)
    request.end()
  })
}
