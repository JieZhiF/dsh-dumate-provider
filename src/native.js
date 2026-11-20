/**
 * dsh-go native half.
 *
 * The web settings page (`client.js`) is a React page the Harness Web UI
 * mounts; the phone app's Flutter shell never runs it. So the same Host data
 * gets a second, native face here: a panel, a composer strip and two
 * composer actions, declared in `package.json` → `dshGo` and served through the
 * bridge's `dshGo` service.
 *
 * Everything goes through the in-process `invoke()` built by `src/routes.js`,
 * which is the very same handler table behind `/api/dumate-provider`. One
 * implementation, two transports — the web page keeps working unchanged.
 *
 * Absent on the desktop/web Host: `registerNative` is only called when the
 * `dshGo` service exists, and the web page never learns about any of this.
 *
 * @module src/native
 */

/** Panel that lists accounts, balance and the day's check-in state. */
export const PANEL = 'dumate'

/** Panel with the 22 per-model switches. */
export const PANEL_MODELS = 'dumate-models'

/** Panel with usage charts, the cooldown setting and the reference list. */
export const PANEL_USAGE = 'dumate-usage'

/** Composer strip above the input box. */
export const STRIP = 'dumate-summary'

/** Action ids declared in the manifest. */
export const ACTION_COOKIE = 'add-cookie'
export const ACTION_CHECKIN = 'checkin'

import { LOGIN_URL } from './browser-login.js'

/** How many chars the strip may show. */
const STRIP_LIMIT = 24

/** Beijing calendar date, matching the rest of the plugin. */
function beijingDate() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/** Thousands-separated integer, or an em dash for a missing reading. */
function num(value) {
  return Number.isFinite(value) ? value.toLocaleString('zh-CN') : '—'
}

/** `MM-DD HH:MM` in Beijing time, for the run log. */
function shortTime(at) {
  if (!Number.isFinite(at) || at <= 0) return ''
  const iso = new Date(at + 8 * 60 * 60 * 1000).toISOString()
  return `${iso.slice(5, 10)} ${iso.slice(11, 16)}`
}

/** One account's check-in line. */
function checkinLine(checkin, today) {
  if (checkin === undefined) return '未查询'
  if (checkin.date === today && checkin.ok) return `已签到 +${num(checkin.points)}`
  if (checkin.date === today) return '今日未签到'
  return '今日未签到'
}

/** Strip text: balance plus the day's check-in, kept inside the 24-char limit. */
export function stripText(snapshot, locale = 'zh') {
  const en = String(locale).toLowerCase().startsWith('en')
  if (snapshot === undefined) return en ? 'DuMate: no account' : '搭子未配置'
  const summary = snapshot.summary ?? {}
  if ((summary.accountCount ?? 0) === 0) return en ? 'DuMate: no account' : '搭子未配置'
  const today = beijingDate()
  const done = (snapshot.accounts ?? []).some(account => account.checkin?.date === today && account.checkin.ok)
  const text = en
    ? `${num(summary.remaining)} pts · ${done ? 'checked in' : 'not checked in'}`
    : `余额${num(summary.remaining)}·${done ? '已签到' : '未签到'}`
  return text.length <= STRIP_LIMIT ? text : `${text.slice(0, STRIP_LIMIT - 1)}…`
}

/** Metric row shared by both panels. */
function head(snapshot) {
  const summary = snapshot?.summary ?? {}
  const today = beijingDate()
  const done = (snapshot?.accounts ?? []).filter(account => account.checkin?.date === today && account.checkin.ok).length
  return {
    type: 'row',
    children: [
      { type: 'metric', label: '余额', value: num(summary.remaining), caption: '积分' },
      { type: 'metric', label: '账号', value: `${summary.enabledCount ?? 0}/${summary.accountCount ?? 0}`, caption: '启用/总数' },
      { type: 'metric', label: '今日签到', value: `${done}`, caption: `共 ${summary.accountCount ?? 0} 个` },
    ],
  }
}

/**
 * Pull a cookie string out of whatever a form submit hands back.
 *
 * @param {any} value - the invoke value envelope.
 * @param {number} [depth]
 * @returns {string} the submitted text, or an empty string.
 */
export function cookieFrom(value, depth = 0) {
  if (depth > 5) return ''
  if (typeof value === 'string') return value.trim()
  if (value === null || typeof value !== 'object') return ''
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = cookieFrom(item, depth + 1)
      if (found !== '') return found
    }
    return ''
  }
  // Known envelopes first: a bare `{cookie}` / `{data:{cookie}}` / `{value:{…}}`.
  for (const key of ['cookie', 'Cookie', 'text', 'value', 'data', 'fields', 'form', 'input', 'values', 'formData']) {
    const found = cookieFrom(value[key], depth + 1)
    if (found !== '') return found
  }
  // Unknown envelope: accept any string shaped like a cookie header.
  for (const item of Object.values(value)) {
    if (typeof item === 'string' && item.includes('=') && (/BDUSS=/.test(item) || item.includes(';'))) return item.trim()
    if (item !== null && typeof item === 'object') {
      const found = cookieFrom(item, depth + 1)
      if (found !== '') return found
    }
  }
  return ''
}

/** The manage action an account button carries. */
const manage = args => ({ id: 'manage', args })

/**
 * The overview panel: one block per account plus the global buttons.
 *
 * @param {object|undefined} snapshot - `GET /state` body, or undefined before the first load.
 * @param {string|undefined} pendingRemove - account id awaiting the second tap.
 * @param {string} [locale]
 */
export function overviewView(snapshot, pendingRemove, locale = 'zh') {
  const en = String(locale).toLowerCase().startsWith('en')
  const today = beijingDate()
  const accounts = snapshot?.accounts ?? []
  const children = [head(snapshot)]

  if (snapshot === undefined) {
    children.push({ type: 'callout', text: en ? 'Loading…' : '正在读取搭子状态…', tone: 'info' })
  } else if (accounts.length === 0) {
    children.push({
      type: 'callout',
      tone: 'info',
      text: en
        ? 'No account yet. Sign in at dumate.cn in a browser, copy the Cookie request header, then use the “Add cookie” action above the input box.'
        : '还没有账号：在浏览器登录 www.dumate.cn，复制 Cookie 请求头，再点输入框上方的「贴搭子 Cookie」。',
    })
  }

  for (const account of accounts) {
    const stale = account.lastError !== '' && account.lastError !== undefined
    children.push({
      type: 'stack',
      children: [
        {
          type: 'keyValue',
          items: [
            ['账号', account.name],
            ['状态', account.enabled ? (stale ? `异常：${account.lastError}` : '正常') : '已停用'],
            ['余额', `${num(account.balance?.remaining)} 积分`],
            ['签到', checkinLine(account.checkin, today)],
          ],
        },
        {
          type: 'actions',
          items: [
            { label: en ? 'Check in' : '签到', action: manage({ op: 'checkin', id: account.id }) },
            { label: en ? (account.enabled ? 'Disable' : 'Enable') : (account.enabled ? '停用' : '启用'), action: manage({ op: 'toggle', id: account.id }) },
            { label: en ? 'Delete' : '删除', style: 'plain', action: manage({ op: 'ask-remove', id: account.id }) },
          ],
        },
      ],
    })
  }

  // Check-in history: the same bounded run log the web page shows.
  const runs = (snapshot?.runs ?? []).slice(-5).reverse()
  if (runs.length > 0) {
    children.push({ type: 'text', text: en ? 'Recent check-ins' : '最近签到' })
    children.push({
      type: 'list',
      items: runs.map(run => ({
        title: `${run.name ?? run.accountId ?? '账号'} · ${shortTime(run.at)}`.trim(),
        subtitle: String(run.message ?? (run.ok ? '成功' : '失败')).slice(0, 60),
        tone: run.ok === true ? 'good' : 'bad',
      })),
    })
  }

  if (pendingRemove !== undefined) {
    const target = accounts.find(account => account.id === pendingRemove)
    children.push({
      type: 'callout',
      tone: 'warn',
      text: en ? `Delete ${target?.name ?? pendingRemove}? Its cookie is removed from this phone.` : `确认删除「${target?.name ?? pendingRemove}」？只会删掉本机保存的 Cookie。`,
    })
    children.push({
      type: 'options',
      id: 'manage',
      options: [
        { label: en ? 'Delete it' : '确认删除', value: `remove|${pendingRemove}` },
        { label: en ? 'Keep it' : '保留', value: 'cancel' },
      ],
    })
  }

  // Account intake. A panel cannot read the clipboard and the app caps form
  // fields at 256 characters, so a pasted Cookie header does not fit anywhere
  // except the composer action — the panel sends the user there.
  children.push({ type: 'text', text: en ? 'Add an account' : '添加账号' })
  children.push({
    type: 'callout',
    tone: 'info',
    text: en
      ? 'Copy the Cookie block, then tap “Add cookie” above the input box. It reads the whole clipboard and keeps only BDUSS.'
      : '复制整段 Cookie，再点输入框上方的「贴搭子Cookie」——它读整段剪贴板，只挑 BDUSS。',
  })
  children.push({
    type: 'actions',
    items: [
      { label: en ? 'Open sign-in page' : '打开登录页', action: manage({ op: 'open-login' }) },
    ],
  })

  children.push({
    type: 'actions',
    items: [
      { label: en ? 'Refresh' : '刷新余额', action: manage({ op: 'refresh' }) },
      { label: en ? 'Check in all' : '全部签到', action: manage({ op: 'checkin-all' }) },
      { label: en ? 'Models' : '模型开关', action: manage({ op: 'open-models' }) },
      { label: en ? 'Usage' : '用量与冷却', action: manage({ op: 'open-usage' }) },
    ],
  })

  return { type: 'stack', title: en ? 'Baidu DuMate' : '百度搭子', children }
}

/**
 * Sister projects worth crediting: they cover the same upstream from other
 * angles, and more than one shape of this plugin was informed by them.
 *
 * Kept as data so the panel and the README cannot drift apart.
 */
export const REFERENCES = [
  { name: 'dumate2api', url: 'https://github.com/wearetheone777/dumate2api', what: '搭子 / 千问办公 / TRAE / Qoder 的三协议网关', whatEn: 'DuMate & friends as OpenAI / Anthropic / Google gateways' },
  { name: 'magpie-dumate', url: 'https://github.com/R227BOUT/magpie-dumate', what: '接入 Magpie 的个人积分通道', whatEn: 'DuMate personal points as a Magpie provider' },
  { name: 'dumate-rance', url: 'https://github.com/RanceLee233/dumate-rance', what: '跨平台登录态与模型发现', whatEn: 'cross-platform sign-in and model discovery' },
  { name: 'Alphaxiaoteng/dumate2api', url: 'https://github.com/Alphaxiaoteng/dumate2api', what: 'OpenAI 兼容反代', whatEn: 'OpenAI-compatible reverse proxy' },
]

/** Largest spend in a list, for scaling bars; 0 when there is nothing. */
function peak(rows) {
  return rows.reduce((max, row) => Math.max(max, Number(row.points) || 0), 0)
}

/**
 * The usage panel: spend per account, spend per session, and the cooldown knob.
 *
 * @param {object|undefined} snapshot - `GET /state` body.
 * @param {string} [locale]
 */
export function usageView(snapshot, locale = 'zh') {
  const en = String(locale).toLowerCase().startsWith('en')
  const accounts = snapshot?.accountUsage ?? []
  const sessions = snapshot?.sessionUsage ?? []
  const cooldown = Number(snapshot?.settings?.cooldownSeconds ?? 60)
  const children = []

  if (snapshot === undefined) {
    children.push({ type: 'callout', text: en ? 'Loading…' : '正在读取用量…', tone: 'info' })
  } else if (accounts.length === 0 && sessions.length === 0) {
    children.push({
      type: 'callout',
      tone: 'info',
      text: en
        ? 'No usage recorded yet. Spend appears after a turn finishes; DuMate stamps charges a few seconds late.'
        : '还没有用量记录。一轮结束后才会入账；搭子的扣费记录会晚几秒才盖上时间戳。',
    })
  }

  if (accounts.length > 0) {
    children.push({ type: 'text', text: en ? 'By account' : '按账号' })
    children.push({
      type: 'chart',
      kind: 'bar',
      categories: accounts.slice(0, 6).map(row => String(row.name ?? row.accountId).slice(0, 8)),
      series: [{ name: en ? 'Points' : '积分', values: accounts.slice(0, 6).map(row => row.points) }],
      unit: en ? 'pts' : '积分',
      caption: en
        ? `Total ${num(accounts.reduce((sum, row) => sum + row.points, 0))} points across ${accounts.length} accounts`
        : `共 ${num(accounts.reduce((sum, row) => sum + row.points, 0))} 积分，${accounts.length} 个账号`,
    })
    children.push({
      type: 'list',
      items: accounts.slice(0, 8).map(row => ({
        title: String(row.name ?? row.accountId),
        subtitle: `${num(row.points)} 积分 · ${row.turns} 轮`,
        trailing: peak(accounts) > 0 ? `${Math.round((row.points / peak(accounts)) * 100)}%` : '',
      })),
    })
  }

  if (sessions.length > 0) {
    children.push({ type: 'text', text: en ? 'By session' : '按会话' })
    const recent = sessions.slice(0, 8)
    children.push({
      type: 'chart',
      kind: 'bar',
      categories: recent.map(row => shortTime(row.at) || String(row.sessionId).slice(0, 6)),
      series: [{ name: en ? 'Points' : '积分', values: recent.map(row => row.points) }],
      unit: en ? 'pts' : '积分',
      caption: en ? 'Newest 8 sessions with a charge' : '最近 8 个有扣费的会话',
    })
    children.push({
      type: 'list',
      items: recent.map(row => ({
        title: `${shortTime(row.at)} · ${String(row.sessionId).slice(0, 8)}`,
        subtitle: `${num(row.points)} 积分`,
      })),
    })
  }

  // ── cooldown ────────────────────────────────────────────────────────────
  children.push({ type: 'text', text: en ? 'Failure cooldown' : '失败冷却' })
  children.push({
    type: 'callout',
    tone: cooldown === 0 ? 'warn' : 'info',
    text: cooldown === 0
      ? (en ? 'Cooldown is off: a failing account is retried immediately.' : '已关闭冷却：账号失败后立刻重试。')
      : (en
          ? `Start ${cooldown}s, doubling to a 15-minute cap; a refused cookie parks for the full cap.`
          : `起点 ${cooldown} 秒，翻倍到 15 分钟封顶；Cookie 被拒直接冷却满 15 分钟。`),
  })
  children.push({
    type: 'options',
    id: 'manage',
    selected: String(cooldown),
    options: [
      { label: en ? 'Off (0)' : '关闭（0）', value: 'cooldown|0' },
      { label: '30s', value: 'cooldown|30' },
      { label: '60s', value: 'cooldown|60' },
      { label: '120s', value: 'cooldown|120' },
      { label: '300s', value: 'cooldown|300' },
    ],
  })
  children.push({
    type: 'actions',
    items: [
      { label: en ? 'Refresh usage' : '刷新用量', action: manage({ op: 'usage-refresh' }) },
      { label: en ? 'Refresh balance' : '刷新余额', action: manage({ op: 'refresh' }) },
      { label: en ? 'Clear cooldowns' : '清除冷却', action: manage({ op: 'clear-cooldown' }) },
      { label: en ? 'This plugin' : '本项目主页', action: manage({ op: 'open-home' }) },
    ],
  })

  // ── references ──────────────────────────────────────────────────────────
  children.push({ type: 'text', text: en ? 'Sister projects' : '同类项目参考' })
  children.push({
    type: 'list',
    items: REFERENCES.map(ref => ({
      title: ref.name,
      subtitle: String(en ? ref.whatEn : ref.what).slice(0, 40),
    })),
  })

  return { type: 'stack', title: en ? 'Usage' : '用量与冷却', children }
}

/** The per-model switch panel. */
export function modelsView(snapshot, locale = 'zh') {
  const en = String(locale).toLowerCase().startsWith('en')
  const rows = (snapshot?.models ?? []).map(model => ({
    type: 'actions',
    items: [
      {
        label: `${model.enabled ? '✓' : '✗'} ${model.label}`,
        style: 'plain',
        action: manage({ op: 'model', id: model.id }),
      },
    ],
  }))
  return {
    type: 'stack',
    title: en ? 'Models' : '模型开关',
    children: [
      { type: 'callout', tone: 'info', text: en ? 'Tap a model to turn it on or off.' : '点一下切换某个模型是否出现在选择器里。' },
      ...rows,
      {
        type: 'actions',
        items: [
          { label: en ? 'All on' : '全部开启', style: 'primary', action: manage({ op: 'models-all', enabled: true }) },
          { label: en ? 'All off' : '全部关闭', style: 'plain', action: manage({ op: 'models-all', enabled: false }) },
        ],
      },
    ],
  }
}

/**
 * Never let a view builder throw into the bridge: a throwing view is what turns
 * one bad field into a blank panel (or, on some app builds, a frozen screen).
 *
 * @param {(scope:object, caps:object)=>object} build
 * @param {object} [logger]
 */
function safeView(build, logger) {
  return (scope, caps) => {
    try {
      return build(scope, caps)
    } catch (error) {
      logger?.warn?.(`dumate-provider: native view failed: ${error?.message ?? error}`)
      return {
        type: 'stack',
        title: '百度搭子',
        children: [{ type: 'callout', tone: 'bad', text: `面板渲染失败：${error?.message ?? error}` }],
      }
    }
  }
}

/**
 * Register the native contributions. Called only when the `dshGo` service is
 * present (dsh-go phone app); a no-op everywhere else.
 *
 * @param {object} ctx - a context that has `dshGo`.
 * @param {object} deps
 * @param {(method:string, path:string, body?:object)=>Promise<{status:number, body:any}>} deps.invoke
 * @param {object} [deps.logger]
 */
export function registerNative(ctx, deps) {
  const { invoke, logger } = deps
  const dshGo = ctx.dshGo
  if (dshGo === undefined || dshGo === null) return

  /** Last `/state` body, so a panel view can be built synchronously. */
  const cache = { snapshot: undefined, pendingRemove: undefined, loginOpenedAt: 0 }

  /** Re-read the settings state; returns the fresh snapshot. */
  const reload = async () => {
    try {
      const result = await invoke('GET', 'state')
      if (result.status === 200 && result.body?.ok === true) cache.snapshot = result.body
      return cache.snapshot
    } catch (error) {
      logger?.warn?.(`dumate-provider: native state read failed: ${error?.message ?? error}`)
      return cache.snapshot
    }
  }

  /** Run one POST and turn a failure into a toast. */
  const post = async (path, body) => {
    try {
      return await invoke('POST', path, body)
    } catch (error) {
      return { status: 500, body: { ok: false, error: error?.message ?? String(error) } }
    }
  }

  /** Toast text from a failed call. */
  const reason = result => result.body?.error ?? '操作失败，请稍后再试'

  /** Turn a handler exception into a toast instead of a bridge 500. */
  const guard = fn => async (scope, event) => {
    try {
      return await fn(scope, event)
    } catch (error) {
      logger?.warn?.(`dumate-provider: native action failed: ${error?.message ?? error}`)
      return { toast: '操作失败，请稍后再试' }
    }
  }

  /** Wrap a slow call in the bridge's deferred-effect shape. */
  const deferred = (label, run) => ({ pending: { label, timeoutMs: 30_000 }, result: run })

  /** Short confirmation for a check-in result. */
  const checkinToast = results => {
    const rows = (Array.isArray(results) ? results : [results]).filter(row => row !== null && typeof row === 'object')
    if (rows.length === 0) return '没有可签到的账号'
    const already = rows.filter(row => row.ok === true && row.already === true).length
    const failed = rows.filter(row => row.ok !== true).length
    const gained = rows.reduce((sum, row) => sum + (row.ok === true && row.already !== true ? Number(row.points) || 0 : 0), 0)
    const parts = []
    if (gained > 0) parts.push(`签到 +${gained}`)
    if (already > 0) parts.push(`${already} 个今日已签`)
    if (failed > 0) parts.push(`${failed} 个失败`)
    if (parts.length === 0) parts.push(rows.every(row => row.ok === true) ? '已签到' : '签到未完成')
    return parts.join('，').slice(0, 40)
  }

  /** One account's check-in verdict, honouring "already done today". */
  const oneCheckinToast = result => {
    const body = result.body ?? {}
    if (body.ok !== true) return String(body.message ?? body.error ?? '签到失败').slice(0, 40)
    if (body.already === true) return '今日已签到，不用再签'
    const points = Number(body.points) || 0
    if (points > 0) return `签到成功 +${points}`
    return String(body.message ?? '已签到，积分稍后到账').slice(0, 40)
  }

  // ── panels ────────────────────────────────────────────────────────────────
  dshGo.panel(PANEL, {
    view: safeView((scope, caps) => overviewView(cache.snapshot, cache.pendingRemove, caps?.locale), logger),
    data: (_scope, emit) => {
      void reload().then(snapshot => {
        if (snapshot !== undefined) emit({ balance: snapshot.summary?.remaining ?? 0 })
      })
      return () => {}
    },
    actions: {
      manage: guard(async (_scope, event) => {
        const args = event?.value ?? {}
        // An `options` node answers with `{ value }`, not with `{ op }`.
        const picked = typeof args.value === 'string' ? args.value : ''
        // A form submit answers with the bound data model, but its envelope
        // differs by app version (`{cookie}`, `{data:{cookie}}`, `{value:{…}}`),
        // and older builds hand back a bare string. Read any of them.
        // Only a real `name=value` header counts: an `options` pick arrives as
        // `{value:'remove|a1'}` and must not be mistaken for a cookie.
        const submitted = picked === '' ? cookieFrom(args) : ''
        if (submitted !== '' && submitted.includes('=')) {
          const cookie = submitted
          return deferred('正在校验 Cookie', async () => {
            const result = await post('account/add', { cookie })
            if (result.status !== 200) return { toast: reason(result) }
            await reload()
            return { toast: `已添加 ${result.body?.account?.name ?? '账号'}`, refresh: true }
          })
        }
        if (picked === 'cancel') {
          cache.pendingRemove = undefined
          return { refresh: true }
        }
        if (picked.startsWith('remove|')) {
          const target = picked.slice('remove|'.length)
          const result = await post('account/remove', { id: target })
          cache.pendingRemove = undefined
          await reload()
          return result.status === 200 ? { toast: '已删除', refresh: true } : { toast: reason(result) }
        }
        const op = String(args.op ?? '')
        const id = typeof args.id === 'string' ? args.id : ''
        const account = cache.snapshot?.accounts?.find(entry => entry.id === id)

        // Slow paths (network) answer `pending`: the bridge only allows 3 s for
        // the synchronous part of a handler, and a balance refresh can take
        // longer than that on a phone connection.
        if (op === 'refresh') return deferred('正在刷新余额', async () => {
          const result = await post('balance/refresh')
          await reload()
          return result.status === 200 ? { toast: '已刷新' } : { toast: reason(result) }
        })
        if (op === 'checkin-all') return deferred('正在全部签到', async () => {
          const result = await post('checkin/all')
          await reload()
          return result.status === 200 ? { toast: checkinToast(result.body?.results) } : { toast: reason(result) }
        })
        if (op === 'checkin' && id !== '') return deferred('正在签到', async () => {
          const result = await post('account/checkin', { id, force: true })
          await reload()
          if (result.status !== 200) return { toast: reason(result) }
          return { toast: oneCheckinToast(result) }
        })
        if (op === 'toggle' && id !== '' && account !== undefined) {
          const result = await post('account/update', { id, enabled: account.enabled !== true })
          await reload()
          return result.status === 200
            ? { toast: account.enabled === true ? `已停用 ${account.name}` : `已启用 ${account.name}`, refresh: true }
            : { toast: reason(result) }
        }
        if (op === 'ask-remove' && id !== '') {
          cache.pendingRemove = id
          return { refresh: true }
        }
        if (op === 'open-models') return { open: `panel:${PANEL_MODELS}` }
        if (op === 'open-usage') return { open: `panel:${PANEL_USAGE}` }
        // The phone's browser has no DevTools, so this only opens the page; the
        // cookie still has to be copied on a device that can show it. Tapping it
        // again within a few seconds is a no-op: each tap is a browser intent,
        // and a burst of them is what makes the app stumble.
        if (op === 'open-login') {
          const now = Date.now()
          if (now - cache.loginOpenedAt < 5000) return { toast: '登录页已经打开了' }
          cache.loginOpenedAt = now
          return { link: LOGIN_URL }
        }
        if (op === 'model' && id !== '') {
          const current = cache.snapshot?.models?.find(model => model.id === id)
          const result = await post('models', { id, enabled: current?.enabled !== true })
          await reload()
          return result.status === 200 ? { toast: current?.enabled === true ? '已关闭' : '已开启', refresh: true } : { toast: reason(result) }
        }
        if (op === 'models-all') {
          const result = await post('models', { all: true, enabled: args.enabled === true })
          await reload()
          return result.status === 200 ? { toast: args.enabled === true ? '已全部开启' : '已全部关闭', refresh: true } : { toast: reason(result) }
        }
        // A form submit that carried no cookie: say what arrived, so a new app
        // version with a different envelope is diagnosable from the phone.
        if (args !== null && typeof args === 'object' && args.op === undefined && Object.keys(args).length > 0) {
          return { toast: `没读到 Cookie（字段：${Object.keys(args).slice(0, 4).join('、')}）` }
        }
        return { toast: '没有这个操作' }
      }),
    },
  })

  dshGo.panel(PANEL_USAGE, {
    view: safeView((scope, caps) => usageView(cache.snapshot, caps?.locale), logger),
    actions: {
      manage: guard(async (_scope, event) => {
        const args = event?.value ?? {}
        const picked = typeof args.value === 'string' ? args.value : ''
        if (picked.startsWith('cooldown|')) {
          const seconds = Number(picked.slice('cooldown|'.length))
          if (!Number.isFinite(seconds) || seconds < 0) return { toast: '冷却时间不合法' }
          const result = await post('settings', { cooldownSeconds: seconds })
          await reload()
          if (result.status !== 200) return { toast: reason(result) }
          return { toast: seconds === 0 ? '已关闭冷却' : `冷却起点已设为 ${seconds} 秒`, refresh: true }
        }
        const op = String(args.op ?? '')
        if (op === 'usage-refresh') return deferred('正在刷新用量', async () => {
          const result = await post('usage/refresh')
          await reload()
          const added = Number(result.body?.points ?? 0)
          return { toast: added > 0 ? `补记 ${num(added)} 积分` : '没有新的扣费记录' }
        })
        if (op === 'refresh') return deferred('正在刷新余额', async () => {
          const result = await post('balance/refresh')
          await reload()
          return result.status === 200 ? { toast: '已刷新' } : { toast: reason(result) }
        })
        if (op === 'open-home') return { link: 'https://github.com/JieZhiF/dsh-dumate-provider' }
        if (op === 'clear-cooldown') {
          const result = await post('cooldown/clear')
          await reload()
          return result.status === 200 ? { toast: `已清除 ${num(result.body?.cleared ?? 0)} 个冷却` } : { toast: reason(result) }
        }
        return { toast: '没有这个操作' }
      }),
    },
  })

  dshGo.panel(PANEL_MODELS, {
    view: safeView((scope, caps) => modelsView(cache.snapshot, caps?.locale), logger),
    actions: {
      manage: guard(async (_scope, event) => {
        const args = event?.value ?? {}
        const op = String(args.op ?? '')
        const id = typeof args.id === 'string' ? args.id : ''
        if (op === 'model' && id !== '') {
          const current = cache.snapshot?.models?.find(model => model.id === id)
          const result = await post('models', { id, enabled: current?.enabled !== true })
          await reload()
          return result.status === 200 ? { toast: current?.enabled === true ? '已关闭' : '已开启', refresh: true } : { toast: reason(result) }
        }
        if (op === 'models-all') {
          const result = await post('models', { all: true, enabled: args.enabled === true })
          await reload()
          return result.status === 200 ? { toast: args.enabled === true ? '已全部开启' : '已全部关闭', refresh: true } : { toast: reason(result) }
        }
        return { toast: '没有这个操作' }
      }),
    },
  })

  // ── strip ─────────────────────────────────────────────────────────────────
  dshGo.strip(STRIP, (scope, emit, caps) => {
    const push = () => emit({ icon: 'coin', text: stripText(cache.snapshot, caps?.locale ?? scope?.locale ?? 'zh') })
    push()
    let stopped = false
    void reload().then(() => { if (!stopped) push() })
    const timer = setInterval(() => {
      void reload().then(() => { if (!stopped) push() })
    }, 60_000)
    timer.unref?.()
    return () => {
      stopped = true
      clearInterval(timer)
    }
  })

  // ── composer actions ──────────────────────────────────────────────────────
  // "Add cookie" reads the clipboard set by the user in the browser; the whole
  // probe-and-store path is the same `POST /account/add` the web page calls.
  dshGo.on(ACTION_COOKIE, (scope, event) => {
    const cookie = typeof scope?.clipboard === 'string' ? scope.clipboard.trim() : ''
    if (cookie === '') return { toast: '剪贴板里没有 Cookie' }
    return {
      pending: { label: '正在校验 Cookie', timeoutMs: 60_000 },
      result: async () => {
        const result = await post('account/add', { cookie })
        if (result.status !== 200) return { toast: reason(result) }
        // Pull the first balance / check-in reading now, so the panel does not
        // show a fresh account with zeros until it is reopened.
        await post('balance/refresh').catch(() => {})
        await reload()
        try {
          dshGo.refresh?.(PANEL, scope)
        } catch {
          // The panel may not be open; the next open reads the fresh cache.
        }
        const name = result.body?.account?.name ?? '账号'
        return { toast: `已添加 ${name}` }
      },
    }
  })

  dshGo.on(ACTION_CHECKIN, async () => {
    const result = await post('checkin/all')
    await reload()
    return result.status === 200 ? { toast: checkinToast(result.body?.results) } : { toast: reason(result) }
  })

  // Warm the cache so the first panel open has a view to draw.
  void reload()
}
