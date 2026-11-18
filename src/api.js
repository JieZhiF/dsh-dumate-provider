/**
 * The DuMate web account APIs: balance, check-in, and the package breakdown.
 *
 * All of these answer on `https://www.dumate.cn` to the same web cookie the
 * token exchange uses. They were verified live on 2026-11-17; the shapes below
 * come from that traffic, not from documentation.
 *
 * Money arrives as decimal strings (`"28700.00"`) and package expiry as Unix
 * seconds. Normalizing both here keeps every consumer from re-implementing the
 * same parse — and from silently reporting `NaN` as a balance.
 *
 * @module src/api
 */
import { WEB_BASE, WEB_PATHS } from './constants.js'
import { csrfFrom } from './cookie.js'
import { requestText, webHeaders } from './http.js'

/** Codes the service uses for "the session is gone". */
const EXPIRED_CODES = new Set([10001, 10006])

/** Parse a decimal string or number into a finite number, else `fallback`. */
function money(value, fallback = 0) {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

/**
 * Call one web endpoint with the account's cookie.
 *
 * @param {{cookie:string}} account
 * @param {string} path - path including any query string.
 * @param {object} [options]
 * @param {string} [options.method]
 * @param {unknown} [options.body] - serialized as JSON when present.
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ok:boolean, status:number, json:any, text:string, expired:boolean, error?:string}>}
 */
export async function webCall(account, path, options = {}) {
  const cookie = account?.cookie ?? ''
  const csrf = csrfFrom(cookie)
  const headers = webHeaders(cookie === '' ? {} : { cookie })
  if (csrf !== '') headers.csrftoken = csrf
  const payload = options.body === undefined ? undefined : JSON.stringify(options.body)
  if (payload !== undefined) headers['content-type'] = 'application/json'
  const result = await requestText(`${WEB_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: payload,
    timeoutMs: options.timeoutMs ?? 20_000,
    signal: options.signal,
  })
  const json = result.json
  const bodyMessage = typeof json?.message === 'string' ? json.message : typeof json?.message?.global === 'string' ? json.message.global : ''
  const expired =
    result.status === 401 ||
    EXPIRED_CODES.has(json?.code) ||
    /登录凭证已过期|请重新登录|not logged in/i.test(bodyMessage)
  const ok = result.status >= 200 && result.status < 300 && (json === null ? true : json.success !== false && (json.code === undefined || json.code === 0))
  return {
    ok,
    status: result.status,
    json,
    text: result.text,
    expired,
    error: ok ? undefined : bodyMessage || result.error || `HTTP ${result.status || 'network error'}`,
  }
}

/** Raw check-in status payload (`result` of loginBonusInfo). */
export async function checkinStatus(account, options = {}) {
  const response = await webCall(account, WEB_PATHS.checkinInfo, options)
  if (!response.ok) return { ok: false, error: response.error, expired: response.expired }
  const result = response.json?.result ?? {}
  const days = Array.isArray(result.signInDays) ? result.signInDays.filter(day => typeof day === 'string') : []
  const today = beijingToday()
  return {
    ok: true,
    hasIssued: result.hasIssued === true,
    /** True when today's Beijing date is already in `signInDays`. */
    todayDone: result.hasIssued === true || days.includes(today),
    totalTimes: Number.isFinite(result.totalTimes) ? result.totalTimes : days.length,
    totalPoints: money(result.totalPoints),
    signInDays: days,
    streak: streakEndingToday(days, today),
    entranceText: typeof result.entranceText === 'string' ? result.entranceText : '',
    issuedToast: typeof result.issuedToast === 'string' ? result.issuedToast : '',
  }
}

/** Claim today's bonus. The endpoint is idempotent; a second call returns the same verdict. */
export async function claimCheckin(account, options = {}) {
  const response = await webCall(account, WEB_PATHS.checkin, { ...options, method: 'POST', body: {} })
  if (!response.ok) return { ok: false, error: response.error, expired: response.expired }
  return { ok: true, result: response.json?.result ?? null }
}

/**
 * The signed-in Baidu identity, for naming an account.
 *
 * `GET /api/dumate/user/info` returns `displayName` (the Baidu nickname the
 * user sees on dumate.cn) and `userId`. Used only to give a freshly added
 * account a meaningful default name; a failure is non-fatal — the caller
 * falls back to `搭子账号 N`.
 *
 * @returns {Promise<{ok:boolean, name:string, uid:string, error?:string, expired?:boolean}>}
 */
export async function userInfo(account, options = {}) {
  const response = await webCall(account, WEB_PATHS.userInfo, options)
  if (!response.ok) return { ok: false, name: '', uid: '', error: response.error, expired: response.expired }
  const result = response.json?.result ?? {}
  const name = typeof result.displayName === 'string' ? result.displayName.trim() : ''
  const uid = typeof result.userId === 'string' ? result.userId : typeof result.bceUserId === 'string' ? result.bceUserId : ''
  return { ok: true, name, uid }
}

/**
 * Normalized balance view.
 *
 * `totalPoints` in the raw payload sums EVERY Baidu product's packages (a
 * `comate` package used to be folded in), so the headline here is the sum over
 * DuMate packages only. Expired packages are listed with their own flag and
 * never counted.
 *
 * @returns {Promise<{ok:boolean, remaining:number, used:number, granted:number,
 *   isSubscribed:boolean, packages:Array<object>, external:Array<object>,
 *   nextExpiryAt:number, error?:string, expired?:boolean}>}
 */
export async function quotaOverview(account, options = {}) {
  const response = await webCall(account, WEB_PATHS.quota, options)
  if (!response.ok) {
    return { ok: false, error: response.error, expired: response.expired, remaining: 0, used: 0, granted: 0, isSubscribed: false, packages: [], external: [], nextExpiryAt: 0 }
  }
  const result = response.json?.result ?? {}
  const now = Date.now()
  const raw = [
    ...(Array.isArray(result.subscription) ? result.subscription : []),
    ...(Array.isArray(result.incremental) ? result.incremental : []),
  ]
  const packages = []
  const external = []
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue
    const product = typeof entry.product === 'string' && entry.product !== '' ? entry.product : 'dumate'
    const total = money(entry.totalPoints)
    const used = money(entry.usedPoints)
    const expireAt = Number.isFinite(entry.expireDate) ? entry.expireDate * 1000 : 0
    const row = {
      id: String(entry.packageId ?? ''),
      product,
      packageType: String(entry.packageType ?? ''),
      source: String(entry.source ?? ''),
      status: String(entry.status ?? ''),
      total,
      used,
      remaining: Math.max(0, total - used),
      startAt: Number.isFinite(entry.startDate) ? entry.startDate * 1000 : 0,
      expireAt,
      active: entry.status !== 'inactive' && (expireAt === 0 || expireAt > now),
    }
    if (product === 'dumate') packages.push(row)
    else external.push(row)
  }
  const active = packages.filter(row => row.active)
  const remaining = active.reduce((sum, row) => sum + row.remaining, 0)
  const granted = active.reduce((sum, row) => sum + row.total, 0)
  const used = active.reduce((sum, row) => sum + row.used, 0)
  const nextExpiryAt = active.reduce((min, row) => (row.expireAt > 0 && (min === 0 || row.expireAt < min) ? row.expireAt : min), 0)
  return {
    ok: true,
    remaining: round2(remaining),
    used: round2(used),
    granted: round2(granted),
    isSubscribed: result.isSubscribed === true,
    packages: packages.sort((a, b) => b.remaining - a.remaining),
    external,
    nextExpiryAt,
    /** The service's own grand total, kept only so the page can explain a mismatch. */
    reportedTotal: money(result.totalPoints),
    throttled: result.modelThrottleInfo?.throttled === true,
    throttleReason: typeof result.modelThrottleInfo?.reason === 'string' ? result.modelThrottleInfo.reason : '',
  }
}

/** Round to two decimals without `0.1+0.2` noise. */
function round2(value) {
  return Math.round(value * 100) / 100
}

/** Today's Beijing `YYYY-MM-DD`. */
function beijingToday(at = Date.now()) {
  return new Date(at + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/** Number of consecutive days ending today (inclusive). */
function streakEndingToday(days, today) {
  const set = new Set(days)
  if (!set.has(today)) return 0
  let streak = 0
  let cursor = new Date(`${today}T00:00:00Z`).getTime()
  for (;;) {
    const key = new Date(cursor).toISOString().slice(0, 10)
    if (!set.has(key)) break
    streak += 1
    cursor -= 24 * 60 * 60 * 1000
  }
  return streak
}
