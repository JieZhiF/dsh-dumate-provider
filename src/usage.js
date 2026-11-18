/**
 * Per-session point consumption.
 *
 * DuMate bills anonymously: every usage record comes back with an empty
 * `conversationId` (measured across 175 rows), so the upstream cannot tell us
 * which chat a charge belongs to. The only handle is time. Each turn knows
 * when it started and ended; after it finishes we read the usage records that
 * fall inside that window and fold them into the session's running total.
 *
 * Two rules keep the numbers honest:
 *
 * 1. **A charge is counted once, ever.** Every row is fingerprinted (time +
 *    amount + package) and remembered globally, so overlapping windows from
 *    consecutive turns never double-count the same deduction.
 * 2. **A turn reads its own charges first.** Turns are sequential, so the
 *    turn that caused a charge folds it in before any later turn's window can
 *    see it; the forward pad only catches a stamp that lands a few seconds
 *    late. A back pad recovers rows a failed read missed, and the fingerprint
 *    rule means that is the only cost — a rare misattribution when a previous
 *    turn's read failed, never a double count.
 *
 * @module src/usage
 */
import { usageRecords } from './api.js'

/** Seconds of look-back on a turn's window (recovers a missed read). */
const PAD_BACK_S = 30
/** Seconds of look-forward (the charge stamp can lag the stream end). */
const PAD_FWD_S = 90
/** How many counted fingerprints to remember (bounded so state stays small). */
const SEEN_LIMIT = 4000
/** How many sessions to keep totals for. */
const SESSION_LIMIT = 200

export class UsageTracker {
  /**
   * @param {object} options
   * @param {import('./store.js').Store} options.store
   * @param {{info?:Function, warn?:Function}} [options.logger]
   */
  constructor(options) {
    this.store = options.store
    this.logger = options.logger ?? {}
    // Injectable so the time-window attribution can be tested without a live
    // cookie. The default is the real endpoint.
    this.api = { usageRecords, ...(options.api ?? {}) }
    /** Turn start instants (ms) keyed by sessionId, set by the adapter. */
    this.openTurns = new Map()
  }

  /** Call when a turn begins so its window has a lower bound. */
  turnStart(sessionId) {
    const key = String(sessionId ?? '')
    if (key === '') return
    // The earliest open turn wins the lower bound, so parallel steps of one
    // session share a window instead of each narrowing it past a late stamp.
    const started = Date.now()
    const prev = this.openTurns.get(key)
    this.openTurns.set(key, prev === undefined ? started : Math.min(prev, started))
  }

  /**
   * Call when a turn ends: fold the charges inside its window into the
   * session total. Best effort — a failed read leaves the total unchanged and
   * the next turn's back pad still recovers the missed rows.
   *
   * @param {object} account - the account that served the turn.
   * @param {string} sessionId
   * @returns {Promise<{ok:boolean, points:number, total:number, rows:number}>}
   */
  async turnEnd(account, sessionId) {
    const key = String(sessionId ?? '')
    const startedAt = this.openTurns.get(key)
    this.openTurns.delete(key)
    if (key === '' || startedAt === undefined || account === undefined || account.cookie === '') {
      return { ok: false, points: 0, total: this.total(key), rows: 0 }
    }
    const startS = Math.floor(startedAt / 1000) - PAD_BACK_S
    const endS = Math.floor(Date.now() / 1000) + PAD_FWD_S
    const found = await this.api.usageRecords(account, { startAt: startS, endAt: endS, page: 1, limit: 100 })
      .catch(() => ({ ok: false, rows: [] }))
    if (found.ok !== true) {
      return { ok: false, points: 0, total: this.total(key), rows: 0 }
    }
    const candidates = found.rows.filter(row => row.at >= startS && row.at <= endS && row.points > 0)
    let added = 0
    await this.store.update(state => {
      const seen = state.seenChargeSigs ?? (state.seenChargeSigs = [])
      const sessions = state.sessionUsage ?? (state.sessionUsage = {})
      const seenSet = new Set(seen)
      for (const row of candidates) {
        if (seenSet.has(row.sig)) continue
        seenSet.add(row.sig)
        seen.push(row.sig)
        added += row.points
      }
      // Record the session's window even when nothing landed yet: a charge
      // can be stamped after the stream ends, and `rescan` needs the window
      // to attribute it. `view()` hides zero-point entries.
      const prev = Number(sessions[key]?.points ?? 0)
      sessions[key] = { points: Math.round((prev + added) * 100) / 100, at: Date.now(), windowStart: startS }
      state.sessionUsageOrder = pushOrder(state.sessionUsageOrder ?? (state.sessionUsageOrder = []), key)
      for (const stale of trimSessions(sessions, state.sessionUsageOrder, SESSION_LIMIT)) delete sessions[stale]
      if (seen.length > SEEN_LIMIT) state.seenChargeSigs = seen.slice(-SEEN_LIMIT)
    })
    return { ok: true, points: added, total: this.total(key), rows: candidates.length }
  }

  /**
   * Re-scan the sessions that were used recently, folding any charge that
   * landed after its turn's read finished (the upstream stamps in whole
   * seconds and can lag). Most-recent-first, so a late charge is claimed by
   * the session that most plausibly caused it; the fingerprint rule still
   * means every charge is counted exactly once.
   *
   * @param {object} account - the account whose records to read.
   * @param {number} [withinMs] - how recently a session must have been used.
   * @returns {Promise<{ok:boolean, points:number, sessions:number}>}
   */
  async rescan(account, withinMs = 15 * 60 * 1000) {
    if (account === undefined || account.cookie === '') return { ok: false, points: 0, sessions: 0 }
    const state = this.store.get?.() ?? {}
    const sessions = state.sessionUsage ?? {}
    const nowS = Math.floor(Date.now() / 1000)
    const recent = Object.entries(sessions)
      .filter(([, entry]) => Date.now() - Number(entry?.at ?? 0) <= withinMs)
      .map(([id, entry]) => ({ id, windowStart: Number(entry?.windowStart ?? nowS - withinMs / 1000) }))
      .sort((a, b) => Number(sessions[b.id]?.at ?? 0) - Number(sessions[a.id]?.at ?? 0))
    if (recent.length === 0) return { ok: true, points: 0, sessions: 0 }
    // One read covers every recent window: the oldest start to now.
    const startS = Math.min(...recent.map(entry => entry.windowStart)) - PAD_BACK_S
    const found = await this.api.usageRecords(account, { startAt: startS, endAt: nowS + PAD_FWD_S, page: 1, limit: 100 })
      .catch(() => ({ ok: false, rows: [] }))
    if (found.ok !== true) return { ok: false, points: 0, sessions: 0 }
    let added = 0
    let touched = 0
    await this.store.update(mutateState => {
      const seen = mutateState.seenChargeSigs ?? (mutateState.seenChargeSigs = [])
      const live = mutateState.sessionUsage ?? (mutateState.sessionUsage = {})
      const seenSet = new Set(seen)
      for (const entry of recent) {
        const from = entry.windowStart - PAD_BACK_S
        for (const row of found.rows) {
          if (!(row.at >= from && row.at <= nowS + PAD_FWD_S && row.points > 0)) continue
          if (seenSet.has(row.sig)) continue
          seenSet.add(row.sig)
          seen.push(row.sig)
          const prev = Number(live[entry.id]?.points ?? 0)
          live[entry.id] = { points: Math.round((prev + row.points) * 100) / 100, at: Number(live[entry.id]?.at ?? Date.now()), windowStart: from }
          added += row.points
          touched += 1
        }
      }
      if (seen.length > SEEN_LIMIT) mutateState.seenChargeSigs = seen.slice(-SEEN_LIMIT)
    })
    return { ok: true, points: Math.round(added * 100) / 100, sessions: touched > 0 ? recent.length : 0 }
  }

  /** Cumulative points charged to one session so far. */
  total(sessionId) {
    const sessions = this.store.get?.().sessionUsage ?? {}
    return Number(sessions[String(sessionId ?? '')]?.points ?? 0)
  }

  /**
   * Recent sessions with their charged points, newest first — the read model
   * for the settings page. The page is one global view and cannot know which
   * chat is on screen, so it lists the sessions it has seen.
   */
  view() {
    const state = this.store.get?.() ?? {}
    const sessions = state.sessionUsage ?? {}
    const order = state.sessionUsageOrder ?? Object.keys(sessions)
    return [...order]
      .reverse()
      .map(id => ({
        sessionId: id,
        points: Number(sessions[id]?.points ?? 0),
        at: Number(sessions[id]?.at ?? 0),
      }))
      .filter(entry => entry.points > 0)
  }
}

/** Keep a recency order of session keys, capped. */
function pushOrder(order, key) {
  const next = order.filter(entry => entry !== key)
  next.push(key)
  return next
}

/** Which session keys fall outside the most-recent `limit`. */
function trimSessions(sessions, order, limit) {
  const keys = Object.keys(sessions)
  if (keys.length <= limit) return []
  const keep = new Set(order.slice(-limit))
  return keys.filter(key => !keep.has(key))
}
