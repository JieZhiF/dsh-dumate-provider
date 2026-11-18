/**
 * Cookie → gateway token exchange, with a per-account cache.
 *
 * DuMate's personal tier has no API key: the web cookie buys a short-lived
 * bearer token, and that token is what the OpenAI-compatible gateway accepts.
 * Measured 2026-11-17: the token lives ~13 hours, `www.dumate.cn` and
 * `console.bce.baidu.com` return the same token and expiry from the same
 * issuer, and the token itself is host-independent.
 *
 * The cache is per account id and shared by every caller (chat lane, settings
 * page, check-in), so concurrent refreshes collapse into one request.
 *
 * @module src/auth
 */
import { TOKEN_FALLBACK_MS, TOKEN_HOSTS, TOKEN_PATH, TOKEN_REFRESH_SKEW_MS } from './constants.js'
import { requestText, webHeaders } from './http.js'

/** Statuses that mean "this host is unreachable", the only case worth a second host. */
function hostDown(result) {
  if (result.status === 0) return true
  if (result.status >= 500) return true
  // A 2xx that is not JSON is an interception page (login wall, proxy), not an answer.
  if (result.status >= 200 && result.status < 300 && result.json === null) return true
  return false
}

export class TokenPool {
  /**
   * @param {object} [deps]
   * @param {{warn?: Function, info?: Function}} [deps.logger]
   */
  constructor(deps = {}) {
    this.logger = deps.logger ?? {}
    /** @type {Map<string, {token:string, expiresAt:number, refreshing:Promise<any>|null, lastError:string}>} */
    this.entries = new Map()
  }

  entry(accountId) {
    const key = String(accountId)
    let entry = this.entries.get(key)
    if (entry === undefined) {
      entry = { token: '', expiresAt: 0, refreshing: null, lastError: '' }
      this.entries.set(key, entry)
    }
    return entry
  }

  /** Drop one account's cached token, e.g. after a 401 from the gateway. */
  invalidate(accountId) {
    const entry = this.entries.get(String(accountId))
    if (entry !== undefined) {
      entry.token = ''
      entry.expiresAt = 0
    }
  }

  /** Cached expiry, 0 when nothing is cached. */
  expiresAt(accountId) {
    return this.entries.get(String(accountId))?.expiresAt ?? 0
  }

  /**
   * Return a usable token for one account, refreshing when it is within the
   * skew window or when `force` is set.
   *
   * @param {string} accountId
   * @param {string} cookie - canonical cookie header.
   * @param {object} [options]
   * @param {boolean} [options.force] - ignore the cache (a gateway 401 asked for it).
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<{ok:boolean, token?:string, expiresAt?:number, cached?:boolean, expired?:boolean, error?:string}>}
   */
  async token(accountId, cookie, options = {}) {
    const entry = this.entry(accountId)
    const now = Date.now()
    if (!options.force && entry.token !== '' && entry.expiresAt - TOKEN_REFRESH_SKEW_MS > now) {
      return { ok: true, token: entry.token, expiresAt: entry.expiresAt, cached: true }
    }
    if (entry.refreshing !== null) return entry.refreshing
    entry.refreshing = this.#refresh(entry, cookie, options.signal)
      .finally(() => {
        entry.refreshing = null
      })
    return entry.refreshing
  }

  async #refresh(entry, cookie, signal) {
    const headers = webHeaders({ cookie })
    let result = null
    const tried = []
    for (const host of TOKEN_HOSTS) {
      result = await requestText(`${host}${TOKEN_PATH}`, {
        method: 'GET',
        headers,
        timeoutMs: 20_000,
        signal,
      })
      tried.push(`${host.replace('https://', '')}=${result.status === 0 ? 'net-error' : result.status}`)
      const ok = result.status === 200 && result.json?.result?.token
      if (ok) break
      // Only an unreachable host is worth retrying elsewhere: a 401/403 is a
      // credential verdict, 400/404 a request verdict, 429 a quota verdict and
      // a redirect a policy verdict — another host would report the same thing
      // about the same cookie.
      if (!hostDown(result)) break
    }

    const token = result?.json?.result?.token
    if (result?.status !== 200 || typeof token !== 'string' || token === '') {
      const detail = result?.json?.message ?? result?.json?.error ?? result?.error ?? result?.text?.slice(0, 200) ?? ''
      const suffix = tried.length > 1 ? `（尝试过 ${tried.join('、')}）` : ''
      entry.lastError = `取 token 失败：${typeof detail === 'string' ? detail : JSON.stringify(detail)}${suffix}`
      // A 401 here means the cookie is dead; keeping the old token would make
      // every later call fail twice (gateway 401, then a doomed refresh).
      if (result?.status === 401 || result?.status === 403) {
        entry.token = ''
        entry.expiresAt = 0
      }
      return { ok: false, expired: result?.status === 401 || result?.status === 403, error: entry.lastError }
    }

    const parsed = result.json?.result?.expired_at ? Date.parse(result.json.result.expired_at) : Number.NaN
    entry.token = token
    entry.expiresAt = Number.isFinite(parsed) ? parsed : Date.now() + TOKEN_FALLBACK_MS
    entry.lastError = ''
    this.logger.info?.(`dumate-provider: token refreshed (expires ${new Date(entry.expiresAt).toISOString()})`)
    return { ok: true, token: entry.token, expiresAt: entry.expiresAt, cached: false }
  }
}
