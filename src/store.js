/**
 * Persistent plugin state: accounts, settings, model switches, balance and
 * check-in history.
 *
 * One JSON file in the plugin's own data directory, written atomically at mode
 * 0600. It is NOT the profile's `cordis.patch.yml` (which belongs to the user)
 * and not the plugin row's `config` (which would restart the plugin on every
 * model toggle) — the settings page owns these values and changes them many
 * times per session, so they live here.
 *
 * The file carries session cookies, which is why it is created 0600 and why
 * every read-only view goes through {@link Store.publicState}, which never
 * returns a cookie value.
 *
 * @module src/store
 */
import { readJsonFile, writeJsonAtomic } from './util.js'
import { DEFAULT_SETTINGS, MODEL_IDS } from './constants.js'

/** Bump when the shape changes in a way old files cannot satisfy. */
const STATE_VERSION = 1

/** Cap the history arrays so the file cannot grow without bound. */
const HISTORY_LIMIT = 400
const RUN_LIMIT = 100

/** A fresh state object with defaults applied. */
function emptyState() {
  return {
    version: STATE_VERSION,
    settings: { ...DEFAULT_SETTINGS },
    accounts: [],
    apiAccounts: [],
    models: {},
    history: [],
    runs: [],
    // Per-session point consumption (see src/usage.js): totals keyed by
    // sessionId, a recency order, and the fingerprints of charges already
    // counted so an overlapping window never double-counts.
    sessionUsage: {},
    sessionUsageOrder: [],
    seenChargeSigs: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

/**
 * True when a label is an auto-assigned placeholder.
 *
 * Covers every form the plugin has used: `搭子账号 3` (browser sign-in),
 * `账号 1` (store default) and the legacy `账号 a1` (old manual add). The
 * identity backfill adopts the real Baidu name only for these, never for a
 * label the user typed themselves.
 */
export function isPlaceholderName(name) {
  return /^(搭子账号|账号)\s*a?\d+$/i.test(String(name ?? '').trim())
}

/** Coerce one stored account into the current shape. */
function normalizeAccount(raw, index) {
  if (raw === null || typeof raw !== 'object') return undefined
  const id = typeof raw.id === 'string' && raw.id !== '' ? raw.id : `a${index + 1}`
  return {
    id,
    name: typeof raw.name === 'string' && raw.name !== '' ? raw.name : `账号 ${index + 1}`,
    cookie: typeof raw.cookie === 'string' ? raw.cookie : '',
    enabled: raw.enabled !== false,
    priority: Number.isFinite(raw.priority) ? raw.priority : index,
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
    lastError: typeof raw.lastError === 'string' ? raw.lastError : '',
    lastOkAt: Number.isFinite(raw.lastOkAt) ? raw.lastOkAt : 0,
    tokenExpiresAt: Number.isFinite(raw.tokenExpiresAt) ? raw.tokenExpiresAt : 0,
    checkin: raw.checkin !== null && typeof raw.checkin === 'object' ? raw.checkin : { date: '', ok: false, points: 0, at: 0 },
    balance: raw.balance !== null && typeof raw.balance === 'object' ? raw.balance : { remaining: 0, used: 0, granted: 0, at: 0, isSubscribed: false, packages: [], external: [], nextExpiryAt: 0 },
  }
}

/**
 * Coerce one stored API account into the current shape.
 *
 * An API account is a base URL + key + the models that endpoint serves. The key
 * lives in this file with the cookies (mode 0600) and is never returned to the
 * page: {@link Store.publicState} masks it.
 */
function normalizeApiAccount(raw) {
  if (raw === null || typeof raw !== 'object') return undefined
  const baseURL = typeof raw.baseURL === 'string' ? raw.baseURL.trim() : ''
  if (baseURL === '') return undefined
  const models = Array.isArray(raw.models)
    ? raw.models
      .filter(model => model !== null && typeof model === 'object' && typeof model.id === 'string' && model.id !== '')
      .map(model => ({
        id: model.id,
        name: typeof model.name === 'string' && model.name !== '' ? model.name : model.id,
        context: Number.isFinite(model.context) ? model.context : 200_000,
        maxOutput: Number.isFinite(model.maxOutput) ? model.maxOutput : 32_768,
        vision: model.vision === true,
      }))
    : []
  return {
    id: typeof raw.id === 'string' && raw.id !== '' ? raw.id : `api${Date.now().toString(36)}`,
    label: typeof raw.label === 'string' && raw.label !== '' ? raw.label : 'API 端点',
    baseURL,
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
    models,
    enabled: raw.enabled !== false,
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
    lastError: typeof raw.lastError === 'string' ? raw.lastError : '',
    lastOkAt: Number.isFinite(raw.lastOkAt) ? raw.lastOkAt : 0,
  }
}

/** Show that a key exists without leaking it. */
function maskKey(key) {
  const value = String(key ?? '')
  if (value === '') return ''
  if (value.length <= 8) return '••••'
  return `${value.slice(0, 4)}…${value.slice(-4)}`
}

export class Store {
  /**
   * @param {object} options
   * @param {string} options.file - absolute path of state.json.
   * @param {{warn?:Function, info?:Function}} [options.logger]
   */
  constructor(options) {
    this.file = options.file
    this.logger = options.logger ?? {}
    this.state = emptyState()
    this.queue = Promise.resolve()
  }

  /** Load from disk, tolerating a missing or malformed file. */
  async load() {
    const raw = await readJsonFile(this.file, undefined)
    if (raw === undefined) {
      this.logger.info?.('dumate-provider: no state file yet, starting empty')
      return this
    }
    const state = emptyState()
    if (raw.settings !== null && typeof raw.settings === 'object') {
      for (const [key, value] of Object.entries(raw.settings)) {
        if (key in DEFAULT_SETTINGS) state.settings[key] = value
      }
    }
    if (Array.isArray(raw.accounts)) {
      const seen = new Set()
      for (const [index, entry] of raw.accounts.entries()) {
        const account = normalizeAccount(entry, index)
        if (account === undefined || seen.has(account.id)) continue
        seen.add(account.id)
        state.accounts.push(account)
      }
    }
    if (raw.models !== null && typeof raw.models === 'object') {
      for (const id of MODEL_IDS) {
        if (raw.models[id] === false) state.models[id] = false
      }
    }
    if (Array.isArray(raw.apiAccounts)) {
      for (const entry of raw.apiAccounts) {
        if (entry === null || typeof entry !== 'object') continue
        const account = normalizeApiAccount(entry)
        if (account !== undefined) state.apiAccounts.push(account)
      }
    }
    if (Array.isArray(raw.history)) state.history = raw.history.slice(-HISTORY_LIMIT)
    if (Array.isArray(raw.runs)) state.runs = raw.runs.slice(-RUN_LIMIT)
    this.state = state
    return this
  }

  /** Live state (do not mutate without {@link update}). */
  get() {
    return this.state
  }

  /** Settings with defaults already applied. */
  settings() {
    return this.state.settings
  }

  /** Enabled models in catalog order (default: every model). */
  enabledModels() {
    return MODEL_IDS.filter(id => this.state.models[id] !== false)
  }

  /** Whether one model is advertised right now. */
  modelEnabled(id) {
    return this.state.models[id] !== false
  }

  /** Accounts in priority order. */
  accounts() {
    return [...this.state.accounts].sort((a, b) => a.priority - b.priority)
  }

  /** One account by id. */
  account(id) {
    return this.state.accounts.find(entry => entry.id === id)
  }

  /** Mint a stable, human-readable id. */
  nextAccountId() {
    let index = this.state.accounts.length + 1
    const taken = new Set(this.state.accounts.map(entry => entry.id))
    while (taken.has(`a${index}`)) index += 1
    return `a${index}`
  }

  /**
   * Apply a mutation and persist it. Writes are serialized so two overlapping
   * requests cannot interleave a read-modify-write.
   *
   * @param {(state:object) => void} mutate
   */
  update(mutate) {
    this.queue = this.queue.then(async () => {
      mutate(this.state)
      this.state.updatedAt = Date.now()
      if (this.state.history.length > HISTORY_LIMIT) this.state.history = this.state.history.slice(-HISTORY_LIMIT)
      if (this.state.runs.length > RUN_LIMIT) this.state.runs = this.state.runs.slice(-RUN_LIMIT)
      await writeJsonAtomic(this.file, this.state)
    }).catch(error => {
      this.logger.warn?.(`dumate-provider: state write failed: ${error?.message ?? error}`)
    })
    return this.queue
  }

  /** Record one balance reading, one row per Beijing date. */
  recordBalance(total) {
    if (!Number.isFinite(total)) return
    const date = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const existing = this.state.history.find(entry => entry?.date === date)
    if (existing !== undefined) {
      existing.total = total
      existing.at = Date.now()
    } else {
      this.state.history.push({ date, total, at: Date.now() })
    }
  }

  /** Append one check-in attempt to the bounded run log. */
  recordRun(run) {
    this.state.runs.push(run)
  }

  /**
   * The settings page's read model: everything the page shows, with cookie
   * values replaced by facts about them.
   */
  publicState(pool) {
    const accounts = this.accounts().map(account => ({
      id: account.id,
      name: account.name,
      enabled: account.enabled,
      priority: account.priority,
      hasCookie: account.cookie !== '',
      cookieBytes: account.cookie.length,
      lastError: account.lastError,
      lastOkAt: account.lastOkAt,
      tokenExpiresAt: pool?.expiresAt(account.id) ?? account.tokenExpiresAt,
      checkin: account.checkin,
      balance: account.balance,
    }))
    const newest = accounts.reduce((best, account) => {
      const at = account.balance?.at ?? 0
      return at > (best?.balance?.at ?? 0) ? account : best
    }, undefined)
    return {
      settings: { ...this.state.settings },
      accounts,
      apiAccounts: (this.state.apiAccounts ?? []).map(account => ({
        id: account.id,
        label: account.label,
        baseURL: account.baseURL,
        keyMask: maskKey(account.apiKey),
        hasKey: account.apiKey !== '',
        models: account.models,
        enabled: account.enabled,
        lastError: account.lastError,
        lastOkAt: account.lastOkAt,
      })),
      models: MODEL_IDS.map(id => ({ id, enabled: this.state.models[id] !== false })),
      history: this.state.history.slice(-60),
      runs: this.state.runs.slice(-20),
      summary: {
        accountCount: accounts.length,
        enabledCount: accounts.filter(account => account.enabled).length,
        remaining: newest?.balance?.remaining ?? 0,
        used: newest?.balance?.used ?? 0,
        granted: newest?.balance?.granted ?? 0,
        isSubscribed: newest?.balance?.isSubscribed === true,
        nextExpiryAt: newest?.balance?.nextExpiryAt ?? 0,
        balanceAt: newest?.balance?.at ?? 0,
        lowBalance: (newest?.balance?.remaining ?? 0) < this.state.settings.alertThreshold,
      },
    }
  }
}
