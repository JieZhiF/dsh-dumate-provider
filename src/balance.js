/**
 * Balance snapshots and the low-balance signal.
 *
 * The number a user cares about is "how many DuMate points are left", not the
 * service's grand total (which folds in other Baidu products and inactive
 * future packages). So the headline is computed by `quotaOverview`, and this
 * module only adds the per-account persistence and the threshold check.
 *
 * @module src/balance
 */
import { quotaOverview } from './api.js'

export class BalanceService {
  /**
   * @param {object} options
   * @param {import('./store.js').Store} options.store
   * @param {{info?:Function, warn?:Function}} [options.logger]
   */
  constructor(options) {
    this.store = options.store
    this.logger = options.logger ?? {}
    this.refreshing = null
  }

  /**
   * Refresh one account's balance and persist it.
   *
   * @param {object} account - live account record from the store.
   * @returns {Promise<object>} the normalized quota result plus `ok`.
   */
  async refresh(account) {
    const result = await quotaOverview(account)
    if (!result.ok) {
      this.store.update(state => {
        const stored = state.accounts.find(entry => entry.id === account.id)
        if (stored !== undefined) stored.lastError = result.error ?? '余额查询失败'
      })
      return result
    }
    this.store.update(state => {
      const stored = state.accounts.find(entry => entry.id === account.id)
      if (stored === undefined) return
      stored.balance = {
        remaining: result.remaining,
        used: result.used,
        granted: result.granted,
        isSubscribed: result.isSubscribed,
        packages: result.packages,
        external: result.external,
        nextExpiryAt: result.nextExpiryAt,
        throttled: result.throttled,
        throttleReason: result.throttleReason,
        at: Date.now(),
      }
      stored.lastError = ''
      state.history.push({ date: beijingToday(), total: result.remaining, at: Date.now() })
    })
    return result
  }

  /** Refresh every enabled account once, one failure not stopping the rest. */
  async refreshAll() {
    if (this.refreshing !== null) return this.refreshing
    this.refreshing = (async () => {
      const results = []
      for (const account of this.store.accounts()) {
        if (account.cookie === '') continue
        try {
          results.push({ id: account.id, ...(await this.refresh(account)) })
        } catch (error) {
          results.push({ id: account.id, ok: false, error: error?.message ?? String(error) })
        }
      }
      this.checkAlert()
      return results
    })().finally(() => {
      this.refreshing = null
    })
    return this.refreshing
  }

  /** The newest balance reading across accounts. */
  current() {
    let best
    for (const account of this.store.accounts()) {
      const at = account.balance?.at ?? 0
      if (best === undefined || at > (best.balance?.at ?? 0)) best = account
    }
    return {
      accountId: best?.id ?? '',
      remaining: best?.balance?.remaining ?? 0,
      used: best?.balance?.used ?? 0,
      granted: best?.balance?.granted ?? 0,
      isSubscribed: best?.balance?.isSubscribed === true,
      at: best?.balance?.at ?? 0,
      nextExpiryAt: best?.balance?.nextExpiryAt ?? 0,
    }
  }

  /**
   * Warn once per dipping below the threshold, not on every tick.
   *
   * `settings.lastAlertAt` is stamped when the warning fires, so a user who
   * reads it is not nagged again until either they change the threshold or the
   * balance leaves and re-enters the warning band.
   */
  checkAlert() {
    const settings = this.store.settings()
    if (settings.alertEnabled !== true) return false
    const threshold = Number(settings.alertThreshold)
    if (!Number.isFinite(threshold) || threshold <= 0) return false
    const current = this.current()
    if (current.at === 0) return false
    if (current.remaining >= threshold) {
      if (settings.lastAlertAt !== 0) this.store.update(state => { state.settings.lastAlertAt = 0 })
      return false
    }
    if (settings.lastAlertAt !== 0) return false
    this.store.update(state => { state.settings.lastAlertAt = Date.now() })
    this.logger.warn?.(`dumate-provider: 余额 ${current.remaining} 低于阈值 ${threshold}，请及时签到或补充积分。`)
    return true
  }
}

function beijingToday(at = Date.now()) {
  return new Date(at + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}
