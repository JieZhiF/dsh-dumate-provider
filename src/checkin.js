/**
 * Daily check-in: the manual action, the Beijing-time due check, and the
 * bounded record of what happened.
 *
 * The claim endpoint is idempotent (a second call on the same day returns the
 * same verdict without adding points), so the scheduler does not have to be
 * perfect — it has to be *safe to run often*, which is why it ticks every
 * minute and asks "has today's wall-clock time passed and is today still
 * unclaimed" instead of computing a one-shot timeout.
 *
 * @module src/checkin
 */
import { claimCheckin, checkinStatus } from './api.js'
import { beijingDate, beijingMinutes, parseClock } from './util.js'

/** How long a failed automatic attempt waits before retrying. */
const RETRY_AFTER_FAILURE_MS = 30 * 60 * 1000

/** Give the button a friendlier message than the raw upstream string. */
function explain(result) {
  if (result.ok) return '签到成功 / checked in'
  if (result.expired === true) return 'Cookie 已过期，请重新登录 / cookie expired, sign in again'
  return result.error ?? '签到失败 / check-in failed'
}

export class CheckinService {
  /**
   * @param {object} options
   * @param {import('./store.js').Store} options.store
   * @param {{info?:Function, warn?:Function}} [options.logger]
   * @param {(account:object) => Promise<object>} [options.afterCheckin] - called after a successful claim (balance refresh).
   */
  constructor(options) {
    this.store = options.store
    this.logger = options.logger ?? {}
    this.afterCheckin = options.afterCheckin
    this.running = new Set()
  }

  /** Cached status for one account (from the last call, never fetched here). */
  status(account) {
    return account.checkin ?? { date: '', ok: false, points: 0, at: 0 }
  }

  /**
   * Read today's state from the service.
   *
   * @returns {Promise<{ok:boolean, todayDone:boolean, streak:number, totalPoints:number, error?:string, expired?:boolean}>}
   */
  async inspect(account) {
    const status = await checkinStatus(account)
    if (!status.ok) return { ok: false, todayDone: false, streak: 0, totalPoints: 0, error: status.error, expired: status.expired }
    this.store.update(state => {
      const stored = state.accounts.find(entry => entry.id === account.id)
      if (stored === undefined) return
      stored.checkin = {
        ...stored.checkin,
        date: beijingDate(),
        done: status.todayDone,
        streak: status.streak,
        totalPoints: status.totalPoints,
        checkedAt: Date.now(),
      }
    })
    return { ok: true, todayDone: status.todayDone, streak: status.streak, totalPoints: status.totalPoints, issuedToast: status.issuedToast }
  }

  /**
   * Claim today's bonus for one account.
   *
   * `force` is the manual button: it still calls the service even when the
   * cached state says today is done, because the PC-side bonus is a second
   * grant that the web console may not have collected yet.
   *
   * @param {object} account
   * @param {{force?:boolean}} [options]
   */
  async run(account, options = {}) {
    if (this.running.has(account.id)) return { ok: false, skipped: true, message: '签到正在进行 / check-in already running' }
    this.running.add(account.id)
    const before = Number(account.checkin?.totalPoints ?? 0)
    try {
      const status = await checkinStatus(account)
      if (!status.ok) {
        const message = explain(status)
        this.#record(account, { ok: false, message })
        return { ok: false, message, error: status.error, expired: status.expired }
      }
      if (status.todayDone && options.force !== true) {
        this.#storeStatus(account, status)
        return { ok: true, already: true, message: status.issuedToast || '今日已签到 / already checked in today', streak: status.streak }
      }
      const claim = await claimCheckin(account)
      if (!claim.ok) {
        const message = explain(claim)
        this.#record(account, { ok: false, message })
        return { ok: false, message, error: claim.error, expired: claim.expired }
      }
      // Re-read: the claim response does not carry the new streak or total.
      const after = await checkinStatus(account)
      const points = after.ok && before > 0 && after.totalPoints > before ? after.totalPoints - before : 0
      this.#storeStatus(account, after.ok ? after : status, { points, claimed: true })
      const message = after.ok && after.issuedToast !== ''
        ? after.issuedToast
        : `签到成功${points > 0 ? `，+${points} 积分` : ''}`
      this.logger.info?.(`dumate-provider: ${account.name} 签到成功${points > 0 ? ` +${points}` : ''}`)
      if (this.afterCheckin !== undefined) {
        void this.afterCheckin(account).catch(() => {})
      }
      return { ok: true, already: false, points, streak: after.ok ? after.streak : 0, message }
    } catch (error) {
      const message = error?.message ?? String(error)
      this.#record(account, { ok: false, message })
      return { ok: false, message }
    } finally {
      this.running.delete(account.id)
    }
  }

  /**
   * Whether the automatic run is owed right now.
   *
   * @param {object} account
   * @param {number} [at] - instant to evaluate (tests pass their own clock).
   */
  due(account, at = Date.now()) {
    const settings = this.store.settings()
    if (settings.autoCheckin !== true) return false
    if (account.enabled === false || account.cookie === '') return false
    const clock = parseClock(settings.checkinTime) ?? { hour: 9, minute: 17 }
    if (beijingMinutes(at) < clock.hour * 60 + clock.minute) return false
    const today = beijingDate(at)
    const state = account.checkin ?? {}
    // Already claimed or already attempted successfully today.
    if (state.date === today && state.attempted === true) return false
    // A failed attempt retries, but not on every tick: a dead cookie would
    // otherwise hammer the endpoint once a minute until the user notices.
    if (state.date === today && state.attempted === false && Number.isFinite(state.failedAt) && at - state.failedAt < RETRY_AFTER_FAILURE_MS) {
      return false
    }
    return true
  }

  /** Claim for every enabled account whose automatic run is due. */
  async runDue(at = Date.now()) {
    const results = []
    for (const account of this.store.accounts()) {
      if (!this.due(account, at)) continue
      results.push({ accountId: account.id, ...(await this.run(account)) })
    }
    return results
  }

  #storeStatus(account, status, extra = {}) {
    this.store.update(state => {
      const stored = state.accounts.find(entry => entry.id === account.id)
      if (stored === undefined) return
      stored.checkin = {
        ...stored.checkin,
        date: beijingDate(),
        done: status.todayDone === true || extra.claimed === true,
        attempted: true,
        ok: true,
        points: extra.points ?? stored.checkin?.points ?? 0,
        streak: status.streak ?? 0,
        totalPoints: status.totalPoints ?? stored.checkin?.totalPoints ?? 0,
        issuedToast: status.issuedToast ?? '',
        at: Date.now(),
      }
    })
  }

  #record(account, outcome) {
    this.store.update(state => {
      const stored = state.accounts.find(entry => entry.id === account.id)
      if (stored !== undefined) {
        // `attempted: false` keeps the scheduler eligible: a transient failure
        // (network, 5xx) must be retried later the same day.
        stored.checkin = {
          ...stored.checkin,
          date: beijingDate(),
          attempted: outcome.ok === true,
          ok: outcome.ok === true,
          failedAt: outcome.ok === true ? 0 : Date.now(),
          at: Date.now(),
        }
      }
      state.runs.push({ at: Date.now(), accountId: account.id, ok: outcome.ok === true, message: outcome.message })
    })
  }
}
