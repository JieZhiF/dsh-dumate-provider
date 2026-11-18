/**
 * Multi-account selection.
 *
 * Accounts are tried in priority order, skipping any that are disabled,
 * have no cookie, or are cooling down after a failure. Cooling is in-memory
 * and exponential per account, so one dead cookie does not take the lane down
 * while the others still work — and a transient upstream fault does not
 * disable an account for good.
 *
 * @module src/pool
 */
const BASE_COOLDOWN_MS = 60_000
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

  /** Cooldown deadline for one account, 0 when it is ready. */
  cooldownUntil(accountId) {
    const entry = this.cooling.get(String(accountId))
    if (entry === undefined) return 0
    if (entry.until <= Date.now()) {
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

  /**
   * Record a failure and start (or extend) that account's cooldown.
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
    const hinted = Number.isFinite(failure.retryAfterMs) ? failure.retryAfterMs : 0
    const backoff = Math.min(MAX_COOLDOWN_MS, BASE_COOLDOWN_MS * 2 ** (failures - 1))
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
      if (entry.until > Date.now()) out[id] = { until: entry.until, reason: entry.reason }
    }
    return out
  }
}
