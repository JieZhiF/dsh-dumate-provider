/**
 * dsh-dumate-provider — Host half.
 *
 * Registers the `dumate` provider route with the model picker, mounts the
 * settings page's data API, and runs the daily check-in + balance watch.
 *
 * The Host half deliberately imports no `@deepseek-ai/*` package at runtime:
 * the harness service surface is reached through `ctx`, and the adapter is a
 * structural implementation of the contract. That is what lets this single
 * bundle mount on both the 0.2.1 and 0.2.2 host lines without a peer-dependency
 * matrix — the compatibility range lives in `package.json` `engines.dsh`.
 *
 * @module dsh-dumate-provider
 */
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { DumateAdapter } from './src/adapter.js'
import { ApiAdapter } from './src/adapter-api.js'
import { TokenPool } from './src/auth.js'
import { BalanceService } from './src/balance.js'
import { BrowserLogin } from './src/browser-login.js'
import { CheckinService } from './src/checkin.js'
import { NS, PLUGIN_NAME, PROVIDER_NAME, PROVIDER_NAME_API, ROUTE, ROUTE_API } from './src/constants.js'
import { createRejection } from './src/fence.js'
import { AccountPool } from './src/pool.js'
import { createApi } from './src/routes.js'
import { Store } from './src/store.js'

/** How often the scheduler looks at the clock. */
const TICK_MS = 60_000

/** How often a balance snapshot refreshes on its own. */
const BALANCE_REFRESH_MS = 30 * 60 * 1000

/** Plugin name, also the settings-section id it registers on the client half. */
export const name = PLUGIN_NAME

/**
 * The model picker needs the LLM registry, and the check-in scheduler needs the
 * timer service: `ctx.timeout`/`ctx.interval` are a mixin that cannot be read
 * without declaring the service here.
 */
export const inject = ['llm', 'timer']

/** Package version, read from the bundled manifest so it cannot drift from package.json. */
const VERSION = createRequire(import.meta.url)('./package.json').version

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export async function apply(ctx) {
  const logger = ctx.logger
  const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
  const dataDir = path.join(home, PLUGIN_NAME)

  const store = new Store({ file: path.join(dataDir, 'state.json'), logger })
  await store.load()

  const tokens = new TokenPool({ logger })
  const pool = new AccountPool({ store, logger })
  const balance = new BalanceService({ store, logger })
  const checkin = new CheckinService({
    store,
    logger,
    afterCheckin: account => balance.refresh(account),
  })
  const logins = new BrowserLogin({ store, tokens, logger })
  const adapter = new DumateAdapter({ store, tokens, pool, logger })
  const apiAdapter = new ApiAdapter({ store, logger })

  // The provider route: this is what puts 22 models under 百度搭子 in the picker.
  ctx.llm.registerAdapter([ROUTE], adapter)
  // The API lane: an OpenAI-compatible endpoint with a key, when configured.
  ctx.llm.registerAdapter([ROUTE_API], apiAdapter)
  ctx.llm.registerConfigurableProviders?.([
    {
      provider: ROUTE,
      displayName: PROVIDER_NAME,
      settingsNs: ctx.fiber?.entry?.options?.id ?? name,
      settingsPath: [],
    },
    {
      provider: ROUTE_API,
      displayName: PROVIDER_NAME_API,
      settingsNs: ctx.fiber?.entry?.options?.id ?? name,
      settingsPath: [],
    },
  ])

  // ── settings page data API ────────────────────────────────────────────────
  // `ctx.inject` rather than a one-shot `ctx.get('webServer')`: plugins load
  // before the browser half publishes the server, and the callback pends until
  // the service exists.
  const rejection = createRejection(
    () => ctx.get('connection'),
    event => logger.info?.(`dumate-provider: settings request rejected (${event.source}:${event.reason}, ${event.status})`),
  )
  const api = createApi({
    store, tokens, pool, balance, checkin, logins, rejection, version: VERSION, logger,
    // Announce a changed catalog so the picker reloads. The event exists from
    // 0.2.2 on; emitting it on an older host reaches no listener, which is the
    // same result as not emitting at all.
    onCatalogChange: () => {
      try {
        ctx.emit('llm/adapters-updated')
        ctx.emit('llm/models-updated', ROUTE)
        ctx.emit('llm/models-updated', ROUTE_API)
      } catch (error) {
        logger.warn?.(`${PLUGIN_NAME}: catalog announce failed: ${error?.message ?? error}`)
      }
    },
  })
  ctx.inject(['webServer'], scoped => {
    scoped.effect(
      () => scoped.webServer.register({ kind: 'prefix', path: `/api/${NS}`, handler: api }),
      `${PLUGIN_NAME}: settings API`,
    )
    logger.info?.(`${PLUGIN_NAME}: settings API mounted at /api/${NS}`)
  })

  // ── scheduler: daily check-in + periodic balance ──────────────────────────
  ctx.effect(() => {
    let lastBalanceAt = 0
    const tick = () => {
      void (async () => {
        try {
          const ran = await checkin.runDue()
          for (const result of ran) {
            logger.info?.(`${PLUGIN_NAME}: 自动签到 ${result.accountId} → ${result.ok ? 'ok' : result.message}`)
          }
          if (Date.now() - lastBalanceAt > BALANCE_REFRESH_MS) {
            lastBalanceAt = Date.now()
            await balance.refreshAll()
          }
        } catch (error) {
          logger.warn?.(`${PLUGIN_NAME}: scheduler tick failed: ${error?.message ?? error}`)
        }
      })()
    }
    // First tick is deferred so plugin activation never blocks on the network.
    const first = ctx.timeout(tick, 15_000)
    const every = ctx.interval(tick, TICK_MS)
    return () => {
      first()
      every()
    }
  }, `${PLUGIN_NAME}: check-in scheduler`)

  logger.info?.(`${PLUGIN_NAME}: provider "${ROUTE}" registered with ${store.enabledModels().length} models`)
}

/** Locale namespace the client half binds its own copy to. */
export { NS as localeNamespace }
