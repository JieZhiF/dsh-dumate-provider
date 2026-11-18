/**
 * DuMate (百度搭子) fixed facts: endpoints, wire headers and the model catalog.
 *
 * Endpoints and the catalog were verified against the live service on
 * 2026-11-17 (they match the desktop client's own manifest). Nothing here is
 * configurable: a wrong base URL cannot be fixed by the user, so it is not a
 * setting.
 *
 * @module src/constants
 */

/** Provider route registered with the harness; also the picker's group id. */
export const ROUTE = 'dumate'

/** Group title the model picker shows for this provider. */
export const PROVIDER_NAME = '百度搭子'

/** Second route for API-key accounts (enterprise / OpenAI-compatible gateways). */
export const ROUTE_API = 'dumate-api'

/** Picker group title for the API lane. */
export const PROVIDER_NAME_API = '百度搭子 · API'

/** Namespace for the settings page and its locale keys. */
export const NS = 'dumate-provider'

/** Plugin identity, used for the data directory and diagnostics. */
export const PLUGIN_NAME = 'dumate-provider'

/** Public product identity sent as User-Agent, in the harness attribution shape. */
export const USER_AGENT =
  'deepseek-harness (+https://github.com/deepseek-ai/deepseek-harness) dsh-dumate-provider'

/** Web console used for cookies, tokens, points and check-in. */
export const WEB_BASE = 'https://www.dumate.cn'

/**
 * Second entry point to the same token issuer. Measured on 2026-11-17: both
 * hosts return the same token and expiry, so this is a failover host, not a
 * different service.
 */
export const TOKEN_HOSTS = ['https://www.dumate.cn', 'https://console.bce.baidu.com']

/** OpenAI-compatible gateway that actually serves the models. */
export const CHAT_BASE = 'https://dumate-svc.baidu.com'

/** Token issuance path (GET, Cookie + x-dumate-client-type: web). */
export const TOKEN_PATH = '/api/dumate/app/token/get'

/** Chat completions path on the gateway host. */
export const CHAT_PATH = '/gateway/apis/v1/chat/completions'

/** Points and check-in endpoints, all on WEB_BASE with the web cookie. */
export const WEB_PATHS = {
  checkinInfo: '/api/dumate/points/loginBonusInfo',
  checkin: '/api/dumate/points/loginBonus',
  quota: '/api/dumate/points/quota_overview?clientType=desktop&timezone=Asia%2FShanghai&ignoreLoginBonus=true',
  chargeRecords: '/api/dumate/points/records/charge',
}

/** Refresh the token this long before its stated expiry. */
export const TOKEN_REFRESH_SKEW_MS = 10 * 60 * 1000

/** Fallback lifetime when the issuer does not return a parseable expiry. */
export const TOKEN_FALLBACK_MS = 50 * 60 * 1000

/** Beijing offset used for "today" in check-in bookkeeping (no DST since 1991). */
export const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000

/**
 * The 22 models the DuMate account can call, with the limits the client itself
 * declares. `toolCall` is true for every entry; it is kept explicit because a
 * future entry may not be.
 *
 * `vision` drives the picker's modality badge and the image projection: a
 * model without vision receives a text placeholder instead of image bytes.
 */
export const MODELS = [
  { id: 'model-text', name: 'model-text', context: 1_000_000, maxOutput: 384_000, vision: true },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', context: 1_000_000, maxOutput: 384_000, vision: false },
  { id: 'deepseek-v41-flash', name: 'DeepSeek V4.1 Flash', context: 1_000_000, maxOutput: 384_000, vision: true },
  { id: 'deepseek-v4-flash-0731', name: 'DeepSeek V4 Flash 0731', context: 200_000, maxOutput: 32_000, vision: false },
  { id: 'kimi-k3', name: 'Kimi K3', context: 1_048_576, maxOutput: 1_048_576, vision: true },
  { id: 'kimi-k31', name: 'Kimi K3.1', context: 1_048_576, maxOutput: 1_048_576, vision: true },
  { id: 'glm-53', name: 'GLM-5.3', context: 1_000_000, maxOutput: 128_000, vision: false },
  { id: 'glm-53-flash', name: 'GLM-5.3 Flash', context: 1_000_000, maxOutput: 128_000, vision: true },
  { id: 'qwen3.8-max', name: 'Qwen3.8 Max', context: 983_000, maxOutput: 128_000, vision: true },
  { id: 'qwen38-flash', name: 'Qwen3.8 Flash', context: 983_000, maxOutput: 128_000, vision: true },
  { id: 'qwen3.5-27b', name: 'Qwen3.5 27B', context: 200_000, maxOutput: 32_000, vision: false },
  { id: 'qwen3.5-35b-a3b', name: 'Qwen3.5 35B A3B', context: 200_000, maxOutput: 32_000, vision: false },
  { id: 'qwen3.5-397b-a17b', name: 'Qwen3.5 397B A17B', context: 200_000, maxOutput: 32_000, vision: false },
  { id: 'qwen2.5-vl-32b-instruct', name: 'Qwen2.5 VL 32B', context: 200_000, maxOutput: 32_000, vision: true },
  { id: 'doubao-seed-2-0-pro', name: '豆包 Seed 2.0 Pro', context: 200_000, maxOutput: 32_000, vision: false },
  { id: 'ernie-4.5-turbo-vl-32k', name: '文心 4.5 Turbo VL', context: 200_000, maxOutput: 32_000, vision: true },
  { id: 'dm-auto-model/text.L0', name: '搭子自动 · text L0', context: 1_000_000, maxOutput: 384_000, vision: true },
  { id: 'dm-auto-model/text.L1', name: '搭子自动 · text L1', context: 1_048_576, maxOutput: 1_048_576, vision: true },
  { id: 'dm-auto-model/text.L2', name: '搭子自动 · text L2', context: 983_000, maxOutput: 128_000, vision: true },
  { id: 'dm-auto-model/mm.L0', name: '搭子自动 · mm L0', context: 1_000_000, maxOutput: 384_000, vision: true },
  { id: 'dm-auto-model/mm.L1', name: '搭子自动 · mm L1', context: 1_000_000, maxOutput: 384_000, vision: true },
  { id: 'dm-auto-model/mm.L2', name: '搭子自动 · mm L2', context: 1_000_000, maxOutput: 384_000, vision: true },
]

/** Model ids in catalog order, for the settings page's "all on/off". */
export const MODEL_IDS = MODELS.map(entry => entry.id)

/** Look up one catalog row, or undefined for an unknown id. */
export function modelInfo(id) {
  return MODELS.find(entry => entry.id === id)
}

/** Default settings written on first run. */
export const DEFAULT_SETTINGS = {
  /** Run the daily check-in automatically. */
  autoCheckin: true,
  /** Beijing wall-clock time, `HH:MM`. */
  checkinTime: '09:17',
  /**
   * Warn when the newest balance reading falls below this many points.
   *
   * This plugin's check-in is the WEB one: `POST /api/dumate/points/loginBonus`
   * grants 200 a day. The remaining 300 is a separate desktop-client grant
   * ("前往 PC 端可再领取 300 积分") and is not reachable from the web cookie.
   * Measured 2026-11-17.
   *
   * 1000 is therefore five days of this plugin's check-in income, and one third
   * of the 3,000-point seven-day trial grant a new account receives, so a trial
   * user is warned before the grant expires instead of after.
   */
  alertThreshold: 1000,
  /** Show the low-balance banner inside the settings page (always logged). */
  alertEnabled: true,
  /** Page-local refresh cadence for the settings view, in seconds. */
  refreshSeconds: 30,
  /** Points this plugin's daily check-in grants (web end only; the PC end adds 300 separately). */
  webCheckinPoints: 200,
  /** Notified balance floor, so one dip does not warn on every tick. */
  lastAlertAt: 0,
  /** When the user acknowledged the unofficial-integration notice; 0 = never. */
  disclaimerAcceptedAt: 0,
}
