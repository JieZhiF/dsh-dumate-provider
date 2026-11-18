/**
 * The settings page's HTTP surface.
 *
 * The page is same-origin JavaScript, so a JSON API is the simplest transport
 * that works on both host lines. Every route is behind the trust fence in
 * `fence.js`: the plugin's prefix is longer than the kernel's `/api`, and the
 * web server dispatches longest-prefix-first, so without an explicit admission
 * check these routes would answer any loopback caller.
 *
 * @module src/routes
 */
import { normalizeCookie, validateCookie } from './cookie.js'
import { apiCatalog, completionsUrl } from './adapter-api.js'
import { MODEL_IDS, PROVIDER_NAME, modelInfo } from './constants.js'
import { beijingDate } from './util.js'

/**
 * Flat identifier for one request: `POST` + a path whose separators fold to `_`.
 *
 * `/` and `-` both fold, so `api-account/add` reaches `POST_api_account_add`.
 * Kept exported so the mapping is unit-tested rather than discovered in a page.
 *
 * @param {string} method - HTTP verb.
 * @param {string} pathname - request pathname with the plugin prefix removed.
 * @returns {string}
 */
export function routeKey(method, pathname) {
  const path = String(pathname ?? '').replace(/\/$/, '')
  return `${String(method ?? 'GET').toUpperCase()}_${path === '' ? 'state' : path.replace(/[/-]/g, '_')}`
}

/** Request bodies are small JSON objects; refuse anything that is not. */
const MAX_BODY_BYTES = 64 * 1024

/** Read and parse a JSON request body. */
function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (text.trim() === '') {
        resolve({})
        return
      }
      try {
        const value = JSON.parse(text)
        resolve(value !== null && typeof value === 'object' ? value : {})
      } catch {
        reject(new Error('malformed JSON body'))
      }
    })
    req.on('error', reject)
  })
}

/** Write one JSON response. */
function sendJson(res, status, value) {
  const body = `${JSON.stringify(value)}\n`
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

/**
 * Build the request handler.
 *
 * @param {object} deps
 * @param {import('./store.js').Store} deps.store
 * @param {import('./auth.js').TokenPool} deps.tokens
 * @param {import('./pool.js').AccountPool} deps.pool
 * @param {import('./balance.js').BalanceService} deps.balance
 * @param {import('./checkin.js').CheckinService} deps.checkin
 * @param {import('./browser-login.js').BrowserLogin} deps.logins
 * @param {() => void} [deps.onCatalogChange] - announce a changed model catalog.
 * @param {(issue:object)=>number|undefined} deps.rejection - trust fence.
 * @param {string} deps.version
 * @param {object} [deps.logger]
 * @returns {(req:import('node:http').IncomingMessage, res:import('node:http').ServerResponse)=>Promise<void>}
 */
export function createApi(deps) {
  const { store, tokens, pool, balance, checkin, logins, rejection, version, logger } = deps
  const catalogChanged = () => {
    try {
      deps.onCatalogChange?.()
    } catch {
      // Announcing is best effort; the catalog itself is already saved.
    }
  }

  /** One account by id, or undefined. */
  const accountOf = id => store.account(String(id ?? ''))

  /** Refresh one account's cached balance + check-in state without blocking the reply. */
  const warm = account => {
    void balance.refresh(account).catch(() => {})
    void checkin.inspect(account).catch(() => {})
  }

  const routes = {
    /** GET /state — everything the page renders in one round trip. */
    async GET_state(_body, req, res) {
      const publicState = store.publicState(tokens)
      sendJson(res, 200, {
        ok: true,
        version,
        providerName: PROVIDER_NAME,
        ...publicState,
        cooldowns: pool.view(),
        beijingDate: beijingDate(),
        models: MODEL_IDS.map(id => {
          const info = modelInfo(id)
          return {
            id,
            label: info?.name ?? id,
            enabled: store.modelEnabled(id),
            context: info?.context ?? 0,
            maxOutput: info?.maxOutput ?? 0,
            vision: info?.vision === true,
          }
        }),
        runtime: { node: process.version, platform: process.platform },
      })
      void req
    },

    /** POST /account/add {name?, cookie} — validate, then store. */
    async POST_account_add(body, _req, res) {
      const cookie = normalizeCookie(body.cookie)
      const invalid = validateCookie(cookie)
      if (invalid !== undefined) {
        sendJson(res, 400, { ok: false, error: invalid })
        return
      }
      const id = store.nextAccountId()
      const name = typeof body.name === 'string' && body.name.trim() !== '' ? body.name.trim().slice(0, 40) : `账号 ${id}`
      // Prove the cookie buys a token before saving it: a stored dead cookie
      // produces a confusing "expired" on the first chat instead of here.
      const probe = await tokens.token(id, cookie, { force: true })
      if (!probe.ok) {
        sendJson(res, 400, { ok: false, error: probe.error ?? 'Cookie 无法换取 token，请确认已登录搭子网页端' })
        return
      }
      const account = {
        id,
        name,
        cookie,
        enabled: true,
        priority: store.get().accounts.length,
        createdAt: Date.now(),
        lastError: '',
        lastOkAt: 0,
        tokenExpiresAt: probe.expiresAt ?? 0,
        checkin: { date: '', ok: false, points: 0, at: 0 },
        balance: { remaining: 0, used: 0, granted: 0, at: 0, isSubscribed: false, packages: [], external: [], nextExpiryAt: 0 },
      }
      await store.update(state => { state.accounts.push(account) })
      warm(account)
      sendJson(res, 200, { ok: true, account: store.publicState(tokens).accounts.find(entry => entry.id === id) })
    },

    /** POST /account/remove {id} */
    async POST_account_remove(body, _req, res) {
      const account = accountOf(body.id)
      if (account === undefined) {
        sendJson(res, 404, { ok: false, error: '账号不存在' })
        return
      }
      tokens.invalidate(account.id)
      await store.update(state => {
        state.accounts = state.accounts.filter(entry => entry.id !== account.id)
      })
      sendJson(res, 200, { ok: true })
    },

    /** POST /account/update {id, name?, enabled?} */
    async POST_account_update(body, _req, res) {
      const account = accountOf(body.id)
      if (account === undefined) {
        sendJson(res, 404, { ok: false, error: '账号不存在' })
        return
      }
      await store.update(state => {
        const stored = state.accounts.find(entry => entry.id === account.id)
        if (stored === undefined) return
        if (typeof body.name === 'string' && body.name.trim() !== '') stored.name = body.name.trim().slice(0, 40)
        if (typeof body.enabled === 'boolean') stored.enabled = body.enabled
      })
      sendJson(res, 200, { ok: true })
    },

    /** POST /account/login {id, cookie} — replace a dead cookie. */
    async POST_account_login(body, _req, res) {
      const account = accountOf(body.id)
      if (account === undefined) {
        sendJson(res, 404, { ok: false, error: '账号不存在' })
        return
      }
      const cookie = normalizeCookie(body.cookie)
      const invalid = validateCookie(cookie)
      if (invalid !== undefined) {
        sendJson(res, 400, { ok: false, error: invalid })
        return
      }
      const probe = await tokens.token(account.id, cookie, { force: true })
      if (!probe.ok) {
        sendJson(res, 400, { ok: false, error: probe.error ?? 'Cookie 无法换取 token' })
        return
      }
      await store.update(state => {
        const stored = state.accounts.find(entry => entry.id === account.id)
        if (stored === undefined) return
        stored.cookie = cookie
        stored.lastError = ''
        stored.tokenExpiresAt = probe.expiresAt ?? 0
      })
      pool.markSuccess(account.id)
      warm(account)
      sendJson(res, 200, { ok: true })
    },

    /** POST /account/checkin {id, force?} */
    async POST_account_checkin(body, _req, res) {
      const account = accountOf(body.id)
      if (account === undefined) {
        sendJson(res, 404, { ok: false, error: '账号不存在' })
        return
      }
      const result = await checkin.run(account, { force: body.force === true })
      sendJson(res, 200, result)
    },

    /** POST /account/inspect {id} — today's check-in state without claiming. */
    async POST_account_inspect(body, _req, res) {
      const account = accountOf(body.id)
      if (account === undefined) {
        sendJson(res, 404, { ok: false, error: '账号不存在' })
        return
      }
      sendJson(res, 200, await checkin.inspect(account))
    },

    /** POST /account/test {id} — prove the cookie still buys a token. */
    async POST_account_test(body, _req, res) {
      const account = accountOf(body.id)
      if (account === undefined) {
        sendJson(res, 404, { ok: false, error: '账号不存在' })
        return
      }
      const probe = await tokens.token(account.id, account.cookie, { force: true })
      if (probe.ok) {
        await store.update(state => {
          const stored = state.accounts.find(entry => entry.id === account.id)
          if (stored !== undefined) {
            stored.lastError = ''
            stored.tokenExpiresAt = probe.expiresAt ?? 0
          }
        })
      }
      sendJson(res, 200, { ok: probe.ok, expiresAt: probe.expiresAt ?? 0, error: probe.error })
    },

    /** POST /checkin/all — claim for every enabled account. */
    async POST_checkin_all(_body, _req, res) {
      const results = []
      for (const account of store.accounts()) {
        if (account.enabled === false || account.cookie === '') continue
        results.push({ accountId: account.id, name: account.name, ...(await checkin.run(account)) })
      }
      sendJson(res, 200, { ok: true, results })
    },

    /** POST /balance/refresh — refresh every account's balance now. */
    async POST_balance_refresh(_body, _req, res) {
      const results = await balance.refreshAll()
      sendJson(res, 200, { ok: true, results })
    },

    /** POST /settings {…} — merge validated settings. */
    async POST_settings(body, _req, res) {
      const patch = {}
      if (typeof body.autoCheckin === 'boolean') patch.autoCheckin = body.autoCheckin
      if (typeof body.alertEnabled === 'boolean') patch.alertEnabled = body.alertEnabled
      if (typeof body.checkinTime === 'string') {
        const match = /^(\d{1,2}):(\d{2})$/.exec(body.checkinTime.trim())
        if (match === null) {
          sendJson(res, 400, { ok: false, error: '签到时间格式应为 HH:MM' })
          return
        }
        const hour = Number(match[1])
        const minute = Number(match[2])
        if (hour > 23 || minute > 59) {
          sendJson(res, 400, { ok: false, error: '签到时间超出范围' })
          return
        }
        patch.checkinTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
      }
      if (body.alertThreshold !== undefined) {
        const value = Number(body.alertThreshold)
        if (!Number.isFinite(value) || value < 0) {
          sendJson(res, 400, { ok: false, error: '余额阈值必须是非负数' })
          return
        }
        patch.alertThreshold = Math.round(value)
      }
      if (body.refreshSeconds !== undefined) {
        const value = Number(body.refreshSeconds)
        patch.refreshSeconds = Number.isFinite(value) ? Math.min(300, Math.max(10, Math.round(value))) : 30
      }
      if (body.disclaimerAccepted === true) patch.disclaimerAcceptedAt = Date.now()
      await store.update(state => {
        Object.assign(state.settings, patch)
        // A threshold change re-arms the alert so the new value is evaluated.
        if (patch.alertThreshold !== undefined) state.settings.lastAlertAt = 0
      })
      sendJson(res, 200, { ok: true, settings: { ...store.settings() } })
    },

    /** POST /models {id?, enabled, all?} */
    async POST_models(body, _req, res) {
      const enabled = body.enabled === true
      const all = body.all === true || body.id === undefined
      await store.update(state => {
        if (all) {
          for (const id of MODEL_IDS) state.models[id] = enabled
        } else if (MODEL_IDS.includes(String(body.id))) {
          state.models[String(body.id)] = enabled
        }
      })
      catalogChanged()
      sendJson(res, 200, { ok: true, enabledCount: store.enabledModels().length })
    },

    /** POST /login/start — open the sign-in browser and wait for its cookie jar. */
    async POST_login_start(_body, _req, res) {
      const result = await logins.start()
      sendJson(res, result.ok ? 200 : 409, result)
    },

    /** GET /login/status — polling target while the browser window is open. */
    async GET_login_status(_body, _req, res) {
      sendJson(res, 200, { ok: true, ...logins.status() })
    },

    /** POST /login/cancel — close the window without importing anything. */
    async POST_login_cancel(_body, _req, res) {
      sendJson(res, 200, await logins.cancel())
    },

    /** POST /api-account/add {label?, baseURL, apiKey, models[]} */
    async POST_api_account_add(body, _req, res) {
      const baseURL = typeof body.baseURL === 'string' ? body.baseURL.trim() : ''
      if (baseURL === '') {
        sendJson(res, 400, { ok: false, error: 'baseURL 不能为空，例如 https://api.dumate.cn/v1' })
        return
      }
      const account = {
        id: `api${Date.now().toString(36)}`,
        label: typeof body.label === 'string' && body.label.trim() !== '' ? body.label.trim().slice(0, 40) : 'API 端点',
        baseURL,
        apiKey: typeof body.apiKey === 'string' ? body.apiKey.trim() : '',
        models: (Array.isArray(body.models) ? body.models : [])
          .filter(model => model !== null && typeof model === 'object' && typeof model.id === 'string' && model.id !== '')
          .map(model => ({
            id: model.id,
            name: typeof model.name === 'string' && model.name !== '' ? model.name : model.id,
            context: Number.isFinite(model.context) ? model.context : 200_000,
            maxOutput: Number.isFinite(model.maxOutput) ? model.maxOutput : 32_768,
            vision: model.vision === true,
          })),
        enabled: true,
        createdAt: Date.now(),
        lastError: '',
        lastOkAt: 0,
      }
      await store.update(state => {
        state.apiAccounts = [...(state.apiAccounts ?? []), account]
      })
      catalogChanged()
      sendJson(res, 200, { ok: true, id: account.id, models: account.models.length })
    },

    /** POST /api-account/remove {id} */
    async POST_api_account_remove(body, _req, res) {
      const exists = (store.get().apiAccounts ?? []).some(entry => entry.id === String(body.id ?? ''))
      if (!exists) {
        sendJson(res, 404, { ok: false, error: 'API 账号不存在' })
        return
      }
      await store.update(state => {
        state.apiAccounts = state.apiAccounts.filter(entry => entry.id !== String(body.id))
      })
      catalogChanged()
      sendJson(res, 200, { ok: true })
    },

    /** POST /api-account/update {id, label?, enabled?, apiKey?, baseURL?, models?} */
    async POST_api_account_update(body, _req, res) {
      const id = String(body.id ?? '')
      const exists = (store.get().apiAccounts ?? []).some(entry => entry.id === id)
      if (!exists) {
        sendJson(res, 404, { ok: false, error: 'API 账号不存在' })
        return
      }
      await store.update(state => {
        const stored = state.apiAccounts.find(entry => entry.id === id)
        if (stored === undefined) return
        if (typeof body.label === 'string' && body.label.trim() !== '') stored.label = body.label.trim().slice(0, 40)
        if (typeof body.enabled === 'boolean') stored.enabled = body.enabled
        if (typeof body.apiKey === 'string' && body.apiKey.trim() !== '') stored.apiKey = body.apiKey.trim()
        if (typeof body.baseURL === 'string' && body.baseURL.trim() !== '') stored.baseURL = body.baseURL.trim()
        if (Array.isArray(body.models)) {
          stored.models = body.models
            .filter(model => model !== null && typeof model === 'object' && typeof model.id === 'string' && model.id !== '')
            .map(model => ({
              id: model.id,
              name: typeof model.name === 'string' && model.name !== '' ? model.name : model.id,
              context: Number.isFinite(model.context) ? model.context : 200_000,
              maxOutput: Number.isFinite(model.maxOutput) ? model.maxOutput : 32_768,
              vision: model.vision === true,
            }))
        }
      })
      catalogChanged()
      sendJson(res, 200, { ok: true })
    },

    /**
     * POST /api-account/probe {baseURL, apiKey?, id?} — ask the endpoint for its
     * model list (`GET /models`), which is how an OpenAI-compatible server
     * advertises what it serves.
     */
    async POST_api_account_probe(body, _req, res) {
      const stored = (store.get().apiAccounts ?? []).find(entry => entry.id === String(body.id ?? ''))
      const baseURL = (typeof body.baseURL === 'string' && body.baseURL.trim() !== '' ? body.baseURL : stored?.baseURL ?? '').trim()
      const apiKey = (typeof body.apiKey === 'string' && body.apiKey.trim() !== '' ? body.apiKey : stored?.apiKey ?? '').trim()
      if (baseURL === '') {
        sendJson(res, 400, { ok: false, error: 'baseURL 不能为空' })
        return
      }
      const root = baseURL.replace(/\/+$/, '').replace(/\/chat\/completions$/, '')
      try {
        const response = await fetch(`${root}/models`, {
          headers: apiKey === '' ? {} : { authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(15_000),
        })
        const text = await response.text()
        if (!response.ok) {
          sendJson(res, 200, { ok: false, status: response.status, error: `HTTP ${response.status}: ${text.slice(0, 200)}`, models: [] })
          return
        }
        let payload
        try {
          payload = JSON.parse(text)
        } catch {
          sendJson(res, 200, { ok: false, error: '端点返回的不是 JSON（可能不是 OpenAI 兼容接口）', models: [] })
          return
        }
        const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : []
        const models = rows
          .map(row => (typeof row === 'string' ? { id: row } : row !== null && typeof row === 'object' ? { id: String(row.id ?? row.name ?? '') } : undefined))
          .filter(model => model !== undefined && model.id !== '')
          .map(model => ({ id: model.id, name: model.id, context: 200_000, maxOutput: 32_768, vision: false }))
        if (stored !== undefined) {
          await store.update(state => {
            const entry = state.apiAccounts.find(candidate => candidate.id === stored.id)
            if (entry !== undefined) {
              entry.lastError = ''
              entry.lastOkAt = Date.now()
              if (models.length > 0) entry.models = models
            }
          })
        }
        sendJson(res, 200, { ok: true, models, completions: completionsUrl(baseURL) })
      } catch (error) {
        const message = error?.name === 'TimeoutError' ? '探测超时（15s）' : (error?.message ?? String(error))
        if (stored !== undefined) {
          await store.update(state => {
            const entry = state.apiAccounts.find(candidate => candidate.id === stored.id)
            if (entry !== undefined) entry.lastError = message
          })
        }
        sendJson(res, 200, { ok: false, error: message, models: [] })
      }
    },

    /** GET /ping — unauthenticated liveness for the page's first paint. */
    async GET_ping(_body, _req, res) {
      sendJson(res, 200, { ok: true, version })
    },
  }

  return async function api(req, res) {
    const rejected = rejection(req)
    if (rejected !== undefined) {
      const error = rejected === 403 ? 'forbidden' : rejected === 401 ? 'unauthorized' : 'admission unavailable'
      sendJson(res, rejected, { ok: false, error })
      return
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const path = url.pathname.replace(/^\/api\/dumate-provider\/?/, '').replace(/\/$/, '')
    const key = routeKey(req.method, path)
    const handler = routes[key]
    if (handler === undefined) {
      sendJson(res, 404, { ok: false, error: `unknown route ${req.method} ${url.pathname}` })
      return
    }
    try {
      const body = req.method === 'POST' || req.method === 'PUT' ? await readJson(req) : {}
      await handler(body, req, res)
    } catch (error) {
      logger?.warn?.(`dumate-provider: ${req.method} ${url.pathname} failed: ${error?.message ?? error}`)
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: error?.message ?? 'internal error' })
      else res.end()
    }
  }
}
