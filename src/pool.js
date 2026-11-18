/**
 * Multi-account selection.
 *
 * Accounts are tried in priority order, skipping any that are disabled,
 * have no cookie, or are cooling down after a failure. Cooling is in-memory
 * and exponential per account, so one dead cookie does not take the lane down
 * while the others still work — and a transient upstream fault does not
 * disable an account for good.
 *
 * The whole mechanism is tunable through `cooldownSeconds` in the settings
 * store: the base backoff, and `0` disables cooldown entirely (every account
 * is always eligible). A failure still records the reason for the settings
 * page, it just never parks the account.
 *
 * @module src/pool
 */
const DEFAULT_BASE_COOLDOWN_MS = 60_000
const MAX_COOLDOWN_MS = 15 * 60 * 1000

export class AccountPool {
  /**
   * @param {object} options
   * @param {import('./store.js').Store} options.store
   * @param {{info?:Function, warn?:Function}} [options.logger]
   */
  constructor(options) {
    this.store = options.store
    this.logger = options.logger ?? {}
    /** @type {Map<string, {until:number, failures:number, reason:string}>} */
    this.cooling = new Map()
  }

  /**
   * Base backoff in ms from settings.
   *
   * Absent / malformed → the 60s default; an explicit `0` → disabled;
   * a positive number → that many seconds (capped at the 15-minute max).
   */
  baseMs() {
    const raw = this.store.settings?.().cooldownSeconds
    const seconds = Number(raw)
    if (raw === undefined || raw === null || !Number.isFinite(seconds)) return DEFAULT_BASE_COOLDOWN_MS
    if (seconds <= 0) return 0
    return Math.min(seconds, MAX_COOLDOWN_MS / 1000) * 1000
  }

  /** Cooldown deadline for one account, 0 when it is ready. */
  cooldownUntil(accountId) {
    const entry = this.cooling.get(String(accountId))
    if (entry === undefined) return 0
    // `until === 0` is the "cooldown off" record: it must survive so the
    // settings page can still name the last failure, but it never parks.
    if (entry.until !== 0 && entry.until <= Date.now()) {
      this.cooling.delete(String(accountId))
      return 0
    }
    return entry.until
  }

  /** Whether the account can serve a request right now. */
  available(account) {
    return account !== undefined && account.enabled !== false && account.cookie !== '' && this.cooldownUntil(account.id) === 0
  }

  /**
   * Pick the best account for one request.
   *
   * @param {object} [options]
   * @param {Set<string>} [options.exclude] - ids already tried for this request.
   * @returns {object|undefined} the chosen account, or undefined when none is usable.
   */
  pick(options = {}) {
    const exclude = options.exclude ?? new Set()
    for (const account of this.store.accounts()) {
      if (exclude.has(account.id)) continue
      if (this.available(account)) return account
    }
    return undefined
  }

  /** Every account that could be tried, in priority order. */
  ready() {
    return this.store.accounts().filter(account => this.available(account))
  }

  /** Clear one account's cooldown after a successful call. */
  markSuccess(accountId) {
    this.cooling.delete(String(accountId))
  }

  /** Drop one account's cooldown on request (the settings page "取消冷却"). */
  clear(accountId) {
    const had = this.cooling.delete(String(accountId))
    return had
  }

  /** Drop every cooldown. */
  clearAll() {
    const n = this.cooling.size
    this.cooling.clear()
    return n
  }

  /**
   * Record a failure and start (or extend) that account's cooldown.
   *
   * With `cooldownSeconds = 0` the mechanism is off: the reason is still
   * recorded for the settings page, but the account is never parked, so the
   * next request may retry it immediately.
   *
   * @param {string} accountId
   * @param {object} failure
   * @param {string} failure.message
   * @param {number} [failure.status] - HTTP status, 0 for transport.
   * @param {number} [failure.retryAfterMs] - provider hint.
   * @param {boolean} [failure.auth] - the credential itself was refused.
   */
  markFailure(accountId, failure) {
    const key = String(accountId)
    const previous = this.cooling.get(key)?.failures ?? 0
    const failures = previous + 1
    const base = this.baseMs()
    if (base === 0) {
      // Cooldown disabled: remember the reason without a deadline so the page
      // can still show why, but keep the account eligible.
      this.cooling.set(key, { until: 0, failures, reason: failure.message ?? 'failed' })
      return
    }
    const hinted = Number.isFinite(failure.retryAfterMs) ? failure.retryAfterMs : 0
    const backoff = Math.min(MAX_COOLDOWN_MS, base * 2 ** (failures - 1))
    // An auth refusal is not transient: park the account long enough for the
    // user to notice it in the settings page instead of retrying a dead cookie.
    const delay = failure.auth === true ? MAX_COOLDOWN_MS : Math.max(backoff, hinted)
    this.cooling.set(key, { until: Date.now() + delay, failures, reason: failure.message ?? 'failed' })
    this.logger.warn?.(`dumate-provider: account ${key} cooling down for ${Math.round(delay / 1000)}s (${failure.message ?? 'failed'})`)
  }

  /** Snapshot of cooldowns for the settings page. */
  view() {
    const out = {}
    for (const [id, entry] of this.cooling) {
      // With cooldown off the deadline is 0 but the reason still matters.
      if (entry.until > Date.now() || (entry.until === 0 && entry.reason !== '')) {
        out[id] = { until: entry.until, failures: entry.failures, reason: entry.reason }
      }
    }
    return out
  }
}
