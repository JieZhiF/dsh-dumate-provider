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
import { userInfo } from './src/api.js'
import { TokenPool } from './src/auth.js'
import { BalanceService } from './src/balance.js'
import { BrowserLogin } from './src/browser-login.js'
import { CheckinService } from './src/checkin.js'
import { NS, PLUGIN_NAME, PROVIDER_NAME, PROVIDER_NAME_API, ROUTE, ROUTE_API } from './src/constants.js'
import { createRejection } from './src/fence.js'
import { AccountPool } from './src/pool.js'
import { createApi } from './src/routes.js'
import { Store, isPlaceholderName } from './src/store.js'
import { UsageTracker } from './src/usage.js'

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
  const usage = new UsageTracker({ store, logger })
  const adapter = new DumateAdapter({ store, tokens, pool, usage, logger })
  const apiAdapter = new ApiAdapter({ store, logger })

  /**
   * Adopt the Baidu nickname for accounts still carrying an auto-assigned
   * placeholder label (`搭子账号 N` / `账号 N`). A label the user typed or
   * renamed themselves is never touched. Runs inside the refresh tick, so a
   * newly added account gets its real name on the next refresh without a
   * dedicated timer; when no placeholder remains it costs nothing.
   */
  const adoptPlaceholders = async () => {
    for (const account of store.accounts()) {
      if (account.enabled === false || account.cookie === '') continue
      if (!isPlaceholderName(account.name)) continue
      const who = await userInfo({ cookie: account.cookie }).catch(() => ({ ok: false, name: '' }))
      if (who.ok !== true || who.name === '') continue
      await store.update(state => {
        const stored = state.accounts.find(entry => entry.id === account.id)
        // Re-check under the write lock: a rename in the meantime wins.
        if (stored !== undefined && isPlaceholderName(stored.name)) {
          stored.name = who.name.slice(0, 40)
          logger.info?.(`dumate-provider: ${account.id} 采用百度昵称「${who.name}」`)
        }
      })
    }
  }

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
    store, tokens, pool, balance, checkin, logins, usage, rejection, version: VERSION, logger,
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
          // Adopt the Baidu nickname for any account still on a placeholder
          // label (a freshly added one, or one whose name fetch failed). No-op
          // and no network once every account has a real name.
          await adoptPlaceholders()
          const ran = await checkin.runDue()
          for (const result of ran) {
            logger.info?.(`${PLUGIN_NAME}: 自动签到 ${result.accountId} → ${result.ok ? 'ok' : result.message}`)
          }
          if (Date.now() - lastBalanceAt > BALANCE_REFRESH_MS) {
            lastBalanceAt = Date.now()
            await balance.refreshAll()
            // Refresh the check-in state too: it carries the upstream day
            // list, so the record fills without the user pressing anything.
            for (const account of store.accounts()) {
              if (account.enabled !== false && account.cookie !== '') {
                await checkin.inspect(account).catch(() => {})
              }
            }
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
