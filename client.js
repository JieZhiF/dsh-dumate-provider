/**
 * dsh-dumate-provider — browser half.
 *
 * Contributes one settings page (`settings.section` id `dumate-provider`) under
 * 设置 → 百度搭子, and nothing else: the model picker is fed by the Host half's
 * adapter, so there is no second UI to keep in sync.
 *
 * The page reads the plugin's own same-origin API (`/api/dumate-provider/*`)
 * rather than a typed Remote binding, because those routes exist on every host
 * line this bundle supports (0.2.1 and 0.2.2) while the Remote surface is newer.
 *
 * Hand-written ModuleLoader bundle: no build step, no dependency beyond the
 * `react` the shell already provides. Colours come from theme variables so the
 * page survives a scheme switch.
 */
window.__ModuleLoader__.load({
  id: 'dsh-dumate-provider',
  factory: require => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const { createElement: h, Fragment, useState, useEffect, useCallback, useMemo, useRef } = React

    const NS = 'dumate-provider'
    const API = '/api/dumate-provider'
    const inject = ['slots', 'locale']

    // ── copy ────────────────────────────────────────────────────────────────
    const DICT = {
      zh: {
        nav: '百度搭子',
        title: '百度搭子',
        subtitle: '搭子个人账号（免费 / Pro / Max）· 签到积分 · 22 个模型',
        refresh: '刷新',
        refreshing: '刷新中…',
        accounts: '账号',
        addAccount: '添加账号',
        browserLogin: '用浏览器登录',
        browserLoginHint: '会打开一个独立的浏览器窗口（不影响你正在用的浏览器），在里面登录搭子后，本页会自动读取登录态并加好账号。',
        waitingLogin: '已打开登录窗口，请在浏览器里完成百度账号登录…',
        loginOk: '登录成功，账号已添加',
        loginFailed: '登录失败',
        loginTimeout: '等待超时',
        cancelLogin: '取消登录',
        usePaste: '改用粘贴 Cookie',
        backToLogin: '改用浏览器登录',
        loginNoBrowser: '没有找到 Chrome / Edge / Brave，请安装一个或改用粘贴 Cookie',
        name: '备注名',
        namePlaceholder: '例如：搭子主号',
        cookie: 'Cookie',
        cookiePlaceholder: '从浏览器 DevTools 复制：Cookie 请求头、Application → Cookies 的 JSON，或 curl 里的 Cookie 都行',
        cookieHint: 'Cookie 里的 BDUSS 是 httpOnly 的，document.cookie 拿不到；请在 DevTools → Application → Cookies → www.dumate.cn 里复制。',
        personalNoApi: '个人版没有 API：账号只能通过网页 Cookie（或上面的浏览器登录）添加。',
        add: '验证并添加',
        adding: '验证中…',
        reLogin: '重新登录',
        save: '保存',
        cancel: '取消',
        remove: '删除',
        confirmRemove: '确定删除这个账号？Cookie 会一并删除。',
        enable: '启用',
        enabled: '已启用',
        disabled: '已停用',
        test: '测试连接',
        testing: '测试中…',
        cancelCool: '取消冷却',
        rename: '重命名',
        renameHint: '点击右侧 ✎ 可自定义账号名',
        cooldown: '失败冷却（秒）',
        cooldownHint: '账号请求失败后的退避起点：60 → 120 → 240…（上限 15 分钟），Cookie 被拒直接冷却 15 分钟。填 0 关闭冷却，账号永远可重试。',
        cooldownOff: '已关闭',
        checkin: '签到',
        checkinAll: '全部签到',
        checking: '签到中…',
        already: '今日已签',
        notYet: '今日未签',
        checkinGainedOne: '签到成功，+{p} 积分',
        checkinAlreadyOne: '今日已签到，没有重复发放',
        checkinNoPoints: '签到已提交，但未检测到积分到账',
        checkinFailedOne: '签到失败',
        checkinExpired: 'Cookie 已过期，请重新登录后再签到',
        checkinNoReply: '签到无响应',
        checkinNone: '没有可签到的账号（需已启用且配置 Cookie）',
        checkinGained: '{n} 个账号签到成功，共 +{p} 积分',
        checkinAlready: '{n} 个账号今日已签',
        checkinFailed: '{n} 个失败',
        checkinAllFailed: '{n} 个账号签到均失败',
        streak: '连续 {n} 天',
        noCookies: '未配置 Cookie',
        balance: '余额',
        points: '积分',
        member: '会员',
        memberYes: '会员生效中',
        memberNo: '非会员',
        nextExpiry: '最近到期 {date}',
        checkinSettings: '每日签到',
        autoCheckin: '每天自动签到（网页端，+200/天）',
        checkinHint: '搭子把签到分成两端：网页端 +200 由本插件领取；PC 客户端另有 +300，需要在搭子桌面端自己领。',
        checkinTime: '签到时间（北京时间）',
        alert: '余额提醒',
        alertEnabled: '余额不足时在设置页提醒',
        threshold: '提醒阈值（积分）',
        thresholdHint: '低于该积分时提醒。插件走网页端签到，每天 +200；约等于 {days} 天的签到量。',
        pointsUnit: '积分',
        planFree: '免费',
        planName: '{name} 会员',
        planExpires: '{date} 到期',
        planNoExpiry: '长期',
        disclaimerTitle: '非官方接入 · 请先了解风险',
        disclaimerBody: '本插件用你的网页 Cookie 直接调用搭子网页端接口，不是百度官方提供的接入方式。可能违反服务条款、触发风控，极端情况下账号可能被限制；积分按轮扣减（不同模型倍率不同），签到只是补充而不是无限额度。插件不会保存你的密码，只在本机 0600 权限的状态文件里保存 Cookie，随时可删。',
        disclaimerAccept: '我已了解，继续使用',
        disclaimerRead: '查看完整说明',
        apiTitle: 'API 接入（可选）',
        apiHint: '个人版没有 API——只能用上面的网页 Cookie 登录，找不到 API Key 是正常的。只有企业版才有官方 API。若你有企业版或任意 OpenAI 兼容端点，填在这里：模型出现在「百度搭子 · API」分组，不走 Cookie、不消耗搭子积分，也没有签到与余额。',
        apiAdd: '添加 API 端点',
        apiLabel: '名称',
        apiBaseURL: 'Base URL（到 /v1 为止）',
        apiKeyLabel: 'API Key',
        apiProbe: '探测模型',
        apiProbing: '探测中…',
        apiModelsLabel: '模型（每行一个：id 或 id,显示名）',
        apiModelsEmpty: '还没有模型：点「探测模型」或手动填写',
        apiSave: '保存',
        apiSaving: '保存中…',
        apiRemove: '删除',
        apiTest: '测试',
        apiNoKey: '未填 Key',
        apiModelCount: '{n} 个模型',
        apiProbeOk: '探测到 {n} 个模型',
        apiCompletions: '对话地址：{url}',
        models: '模型',
        modelsHint: '关闭的模型会立刻从模型选择器里消失；已锁定的会话会提示错误，而不是 500。',
        enableAll: '全部启用',
        disableAll: '全部禁用',
        context: '上下文 {n}',
        output: '输出 {n}',
        vision: '视觉',
        logs: '最近签到记录',
        noLogs: '还没有记录',
        checkinDays: '签到日历',
        checkinDaysHint: '共 {n} 天 · 来自搭子服务端，含插件之外的签到',
        checkinDaysNone: '暂无签到日期',
        empty: '还没有账号：先把搭子网页端的 Cookie 粘进来。',
        lowBalance: '余额 {n} 积分，低于提醒阈值 {t} 积分，记得签到（网页端每天 +200）或补充积分。',
        error: '操作失败',
        ok: '完成',
        saved: '已保存',
        version: '版本 {v}',
        stale: '数据来自 {time}',
        justNow: '刚刚',
        minutesAgo: '{n} 分钟前',
        hoursAgo: '{n} 小时前',
        daysAgo: '{n} 天前',
        cooling: '冷却中（{n} 秒）',
        coolReason: '冷却中（{n} 秒）：{r}',
        lastError: '最近错误：{e}',
        cookieBytes: 'Cookie {n} 字节',
        confirmed: 'Cookie 有效',
        failed: 'Cookie 无效',
      },
      en: {
        nav: 'Baidu DuMate',
        title: 'Baidu DuMate',
        subtitle: 'Personal accounts (free / Pro / Max) · check-in points · 22 models',
        refresh: 'Refresh',
        refreshing: 'Refreshing…',
        accounts: 'Accounts',
        addAccount: 'Add account',
        browserLogin: 'Sign in with a browser',
        browserLoginHint: 'Opens a separate browser window (your own browser stays untouched); sign in to DuMate there and this page picks up the session automatically.',
        waitingLogin: 'The sign-in window is open — finish signing in there…',
        loginOk: 'Signed in; account added',
        loginFailed: 'Sign-in failed',
        loginTimeout: 'Timed out',
        cancelLogin: 'Cancel sign-in',
        usePaste: 'Paste a cookie instead',
        backToLogin: 'Use browser sign-in',
        loginNoBrowser: 'No Chrome / Edge / Brave found. Install one, or paste a cookie instead.',
        name: 'Label',
        namePlaceholder: 'e.g. main account',
        cookie: 'Cookie',
        cookiePlaceholder: 'Paste the Cookie request header, the DevTools cookie JSON, or the Cookie from a curl command',
        cookieHint: 'BDUSS is httpOnly, so document.cookie cannot read it. Copy it from DevTools → Application → Cookies → www.dumate.cn.',
        personalNoApi: 'The personal tier has no API: an account is added only through the web cookie (or the browser sign-in above).',
        add: 'Validate and add',
        adding: 'Validating…',
        reLogin: 'Sign in again',
        save: 'Save',
        cancel: 'Cancel',
        remove: 'Remove',
        confirmRemove: 'Remove this account and its cookie?',
        enable: 'Enabled',
        enabled: 'Enabled',
        disabled: 'Disabled',
        test: 'Test connection',
        testing: 'Testing…',
        cancelCool: 'Clear cooldown',
        rename: 'Rename',
        renameHint: 'Click the ✎ on the right to rename this account',
        cooldown: 'Failure cooldown (seconds)',
        cooldownHint: 'The backoff start after a request fails: 60 → 120 → 240… (capped at 15 minutes); a refused cookie parks the account for the full cap. Set 0 to disable cooldown so accounts are always retryable.',
        cooldownOff: 'Disabled',
        checkin: 'Check in',
        checkinAll: 'Check in all',
        checking: 'Checking in…',
        already: 'Checked in today',
        notYet: 'Not checked in',
        checkinGainedOne: 'Checked in, +{p} points',
        checkinAlreadyOne: 'Already checked in today — nothing was re-granted',
        checkinNoPoints: 'Claim submitted, but no points were detected',
        checkinFailedOne: 'Check-in failed',
        checkinExpired: 'Cookie expired — sign in again before checking in',
        checkinNoReply: 'No response from check-in',
        checkinNone: 'No eligible accounts (enabled with a cookie required)',
        checkinGained: '{n} accounts checked in, +{p} points total',
        checkinAlready: '{n} already checked in today',
        checkinFailed: '{n} failed',
        checkinAllFailed: 'All {n} check-ins failed',
        streak: '{n}-day streak',
        noCookies: 'No cookie yet',
        balance: 'Balance',
        points: 'points',
        member: 'Membership',
        memberYes: 'Active membership',
        memberNo: 'No membership',
        nextExpiry: 'Next expiry {date}',
        checkinSettings: 'Daily check-in',
        autoCheckin: 'Check in automatically every day (web end, +200/day)',
        checkinHint: 'DuMate splits check-in into two ends: this plugin claims the web one (+200); the PC client grants another 300 that must be claimed in the desktop app.',
        checkinTime: 'Check-in time (Beijing)',
        alert: 'Balance alert',
        alertEnabled: 'Show a notice here when the balance is low',
        threshold: 'Alert threshold (points)',
        thresholdHint: 'Warn below this many points. This plugin claims the web check-in (+200 a day), so this is about {days} day(s) of check-ins.',
        pointsUnit: 'points',
        planFree: 'Free',
        planName: '{name} plan',
        planExpires: 'expires {date}',
        planNoExpiry: 'no expiry',
        disclaimerTitle: 'Unofficial integration · know the risk first',
        disclaimerBody: 'This plugin calls DuMate\'s web endpoints with your browser cookie. It is not a Baidu-supported integration: it may conflict with the terms of service, trip risk controls, and in the worst case get the account restricted. Points are spent per turn (rates differ by model) and check-in only tops them up. The plugin never stores your password; the cookie lives in a local 0600 state file and can be deleted at any time.',
        disclaimerAccept: 'I understand, continue',
        disclaimerRead: 'Read the full note',
        apiTitle: 'API endpoint (optional)',
        apiHint: 'The personal tier has NO API — the web cookie above is the only credential, and there is no API key to find. Only the enterprise plan has an official API. If you have one (or any OpenAI-compatible endpoint), attach it here: its models appear under "Baidu DuMate · API", with no cookie, no point spending, and no check-in or balance.',
        apiAdd: 'Add API endpoint',
        apiLabel: 'Label',
        apiBaseURL: 'Base URL (up to /v1)',
        apiKeyLabel: 'API key',
        apiProbe: 'Probe models',
        apiProbing: 'Probing…',
        apiModelsLabel: 'Models (one per line: id or id,label)',
        apiModelsEmpty: 'No model yet — probe the endpoint or type them',
        apiSave: 'Save',
        apiSaving: 'Saving…',
        apiRemove: 'Remove',
        apiTest: 'Test',
        apiNoKey: 'no key',
        apiModelCount: '{n} models',
        apiProbeOk: 'Found {n} models',
        apiCompletions: 'Chat URL: {url}',
        models: 'Models',
        modelsHint: 'A disabled model disappears from the model picker immediately; a session already locked to it reports a readable error instead of a 500.',
        enableAll: 'Enable all',
        disableAll: 'Disable all',
        context: 'context {n}',
        output: 'output {n}',
        vision: 'vision',
        logs: 'Recent check-ins',
        noLogs: 'Nothing yet',
        checkinDays: 'Check-in calendar',
        checkinDaysHint: '{n} days total · from the DuMate server, includes check-ins made outside this plugin',
        checkinDaysNone: 'No check-in dates yet',
        empty: 'No account yet — paste the DuMate web cookie first.',
        lowBalance: 'Balance {n} points is below the alert threshold {t} points. Check in (+200 a day on the web) or top up.',
        error: 'Failed',
        ok: 'Done',
        saved: 'Saved',
        version: 'version {v}',
        stale: 'Reading from {time}',
        justNow: 'just now',
        minutesAgo: '{n} min ago',
        hoursAgo: '{n} h ago',
        daysAgo: '{n} d ago',
        cooling: 'cooling down ({n}s)',
        coolReason: 'cooling down ({n}s): {r}',
        lastError: 'Last error: {e}',
        cookieBytes: 'cookie {n} bytes',
        confirmed: 'Cookie works',
        failed: 'Cookie rejected',
      },
    }

    /** Resolve the active locale tag without assuming one locale-service shape. */
    function langOf(ctx) {
      try {
        const snapshot = typeof ctx.locale?.getLocale === 'function' ? ctx.locale.getLocale() : ctx.locale?.getSnapshot?.()
        const value = snapshot?.active ?? ctx.locale?.locale
        if (typeof value === 'string' && value !== '') return value
      } catch {
        // fall through to the document language
      }
      try {
        return document.documentElement.lang || 'en'
      } catch {
        return 'en'
      }
    }

    /** Look one key up in the dictionary for the current language. */
    function translate(lang, key, vars) {
      const table = String(lang).toLowerCase().startsWith('zh') ? DICT.zh : DICT.en
      let text = table[key] ?? DICT.en[key] ?? key
      if (vars !== null && vars !== undefined) {
        for (const [name, value] of Object.entries(vars)) text = text.split(`{${name}}`).join(String(value))
      }
      return text
    }

    // ── formatting ──────────────────────────────────────────────────────────
    function formatPoints(value) {
      const n = Number(value)
      if (!Number.isFinite(n)) return '—'
      return n >= 1000 ? n.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : String(Math.round(n * 100) / 100)
    }

    function formatTokens(value) {
      if (!Number.isFinite(value) || value <= 0) return '—'
      if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`
      if (value >= 1000) return `${Math.round(value / 1000)}K`
      return String(value)
    }

    /**
     * Derive the membership plan a balance snapshot describes.
     *
     * The service reports packages, not a plan name, so the plan is read off
     * the active `plan_*` package (`plan_pro`, `plan_max`, …). An account with
     * only grant/point packages is on the free tier, which is the common case
     * for a new trial account.
     *
     * @param {object|undefined} balance - one account's cached balance.
     * @param {Function} t - translator.
     * @returns {{label:string, tone:'info'|'muted', hint:string}}
     */
    function planOf(balance, t) {
      const packages = Array.isArray(balance?.packages) ? balance.packages : []
      const active = packages.filter(entry => entry.active !== false)
      const plan = active.find(entry => typeof entry.packageType === 'string' && entry.packageType.startsWith('plan_'))
      if (plan === undefined) return { label: t('planFree'), tone: 'muted', hint: t('memberNo') }
      const name = plan.packageType.slice(5).toUpperCase()
      const expireAt = plan.expireAt ?? 0
      return {
        label: t('planName', { name }),
        tone: 'info',
        hint: expireAt > 0 ? t('planExpires', { date: formatDate(expireAt) }) : t('planNoExpiry'),
      }
    }

    /**
     * Turn a check-in result into an honest banner.
     *
     * The claim endpoint answers "success" even when today was already
     * claimed, so the server's `already` / `points` fields — not `ok` — decide
     * the tone: a real grant is green, an already-claimed or no-points-detected
     * answer is a neutral warning, and a failure is red.
     *
     * @param {object|undefined} result - one `account/checkin` reply, or a
     *   `checkin/all` reply carrying `results`.
     * @param {Function} t - translator.
     * @returns {{kind:'ok'|'warn'|'err', text:string}}
     */
    function checkinNotice(result, t) {
      if (result === null || result === undefined) return { kind: 'err', text: t('checkinNoReply') }
      if (Array.isArray(result.results)) {
        const rows = result.results
        if (rows.length === 0) return { kind: 'warn', text: t('checkinNone') }
        const failed = rows.filter(row => row.ok !== true)
        if (failed.length === rows.length) return { kind: 'err', text: t('checkinAllFailed', { n: failed.length }) }
        const earned = rows.filter(row => row.ok === true && row.already !== true && row.granted === true)
        const done = rows.filter(row => row.ok === true && row.already === true)
        const parts = []
        if (earned.length > 0) parts.push(t('checkinGained', { n: earned.length, p: earned.reduce((sum, row) => sum + Number(row.points), 0) }))
        if (done.length > 0) parts.push(t('checkinAlready', { n: done.length }))
        if (failed.length > 0) parts.push(t('checkinFailed', { n: failed.length }))
        return { kind: earned.length > 0 ? 'ok' : 'warn', text: parts.join(' · ') }
      }
      if (result.ok !== true) {
        return { kind: 'err', text: result.expired === true ? t('checkinExpired') : (result.message ?? t('checkinFailedOne')) }
      }
      if (result.already === true) return { kind: 'warn', text: result.message ?? t('checkinAlreadyOne') }
      if (result.granted === true) return { kind: 'ok', text: result.message ?? t('checkinGainedOne', { p: result.points }) }
      return { kind: 'warn', text: result.message ?? t('checkinNoPoints') }
    }

    /** Parse the model textarea: `id` or `id,label` per line. */
    function parseModelLines(text) {
      return String(text ?? '')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line !== '')
        .map(line => {
          const [id, label] = line.split(',').map(part => part.trim())
          return { id, name: label || id, context: 200_000, maxOutput: 32_768, vision: false }
        })
        .filter(model => model.id !== '')
    }

    function formatDate(ms) {
      if (!Number.isFinite(ms) || ms <= 0) return '—'
      try {
        return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      } catch {
        return new Date(ms).toISOString().slice(0, 10)
      }
    }

    function ago(ms, t) {
      if (!Number.isFinite(ms) || ms <= 0) return '—'
      const delta = Date.now() - ms
      if (delta < 60_000) return t('justNow')
      if (delta < 3_600_000) return t('minutesAgo', { n: Math.floor(delta / 60_000) })
      if (delta < 86_400_000) return t('hoursAgo', { n: Math.floor(delta / 3_600_000) })
      return t('daysAgo', { n: Math.floor(delta / 86_400_000) })
    }

    // ── styles ──────────────────────────────────────────────────────────────
    const CSS = `
      .dp-root { display: flex; flex-direction: column; gap: 16px; padding: 6px 2px 48px; color: var(--dsw-alias-label-primary, #1f2328); font-size: 14px; line-height: 1.55; }
      .dp-hero { display: flex; flex-direction: column; gap: 4px; }
      .dp-title { font-size: 20px; font-weight: 650; }
      .dp-sub { color: var(--dsw-alias-label-tertiary, #6b7280); font-size: 13px; }
      .dp-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
      .dp-card { border: 1px solid var(--dsw-alias-border-l1, #e5e7eb); border-radius: 12px; padding: 14px 15px; background: var(--dsw-alias-bg-layer-2, #fafafa); display: flex; flex-direction: column; gap: 8px; min-width: 0; }
      .dp-card-head { display: flex; align-items: center; gap: 8px; justify-content: space-between; }
      .dp-name { font-weight: 600; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dp-nameblock { display: flex; flex-direction: column; min-width: 0; gap: 1px; cursor: default; }
      .dp-name-sub { font-size: 11px; color: var(--dsw-alias-label-tertiary, #6b7280); font-variant-numeric: tabular-nums; }
      .dp-icon-btn { border: none; background: transparent; color: var(--dsw-alias-label-tertiary, #6b7280); cursor: pointer; font-size: 13px; padding: 2px 5px; border-radius: 6px; flex: none; }
      .dp-icon-btn:hover { background: color-mix(in srgb, var(--dsw-alias-label-tertiary, #6b7280) 14%, transparent); color: inherit; }
      .dp-badge { display: inline-flex; align-items: center; gap: 4px; border-radius: 999px; padding: 2px 9px; font-size: 11.5px; font-weight: 600; line-height: 1.7; flex: none; border: 1px solid transparent; }
      .dp-badge.info { color: var(--dsw-alias-state-business-primary, #2563eb); background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #2563eb) 12%, transparent); }
      .dp-badge.muted { color: var(--dsw-alias-label-tertiary, #6b7280); background: color-mix(in srgb, var(--dsw-alias-label-tertiary, #6b7280) 12%, transparent); }
      .dp-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; background: var(--dsw-alias-state-success-primary, #16a34a); }
      .dp-dot.off { background: var(--dsw-alias-label-tertiary, #9ca3af); }
      .dp-dot.err { background: var(--dsw-alias-state-error-primary, #dc2626); }
      .dp-metric { font-size: 24px; font-weight: 680; font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
      .dp-label { color: var(--dsw-alias-label-tertiary, #6b7280); font-size: 12px; }
      .dp-muted { color: var(--dsw-alias-label-tertiary, #6b7280); }
      .dp-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .dp-btn { border: 1px solid var(--dsw-alias-border-l2, #d1d5db); background: var(--dsw-alias-bg-layer-1, #fff); color: inherit; border-radius: 8px; padding: 8px 14px; font-size: 13px; cursor: pointer; line-height: 1.45; transition: background .12s ease; }
      .dp-btn:hover { background: var(--dsw-alias-interactive-bg-hover, #f3f4f6); }
      .dp-btn:disabled { opacity: .55; cursor: default; }
      .dp-btn.primary { background: var(--dsw-alias-state-business-primary, #2563eb); border-color: transparent; color: #fff; }
      .dp-btn.danger { color: var(--dsw-alias-state-error-primary, #dc2626); }
      .dp-btn.small { padding: 6px 11px; font-size: 12.5px; border-radius: 7px; }
      .dp-input, .dp-area { width: 100%; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l2, #d1d5db); border-radius: 8px; padding: 9px 11px; font: inherit; font-size: 13px; background: var(--dsw-alias-bg-layer-1, #fff); color: inherit; }
      .dp-area { min-height: 92px; resize: vertical; font-family: var(--ds-font-family-code, ui-monospace, monospace); font-size: 12.5px; }
      .dp-section { display: flex; flex-direction: column; gap: 8px; }
      .dp-section-title { font-size: 15px; font-weight: 650; }
      .dp-banner { border-radius: 10px; padding: 11px 13px; font-size: 13px; border: 1px solid; }
      .dp-banner.warn { border-color: var(--dsw-alias-state-warning-primary, #d97706); background: color-mix(in srgb, var(--dsw-alias-state-warning-primary, #d97706) 10%, transparent); }
      .dp-banner.err { border-color: var(--dsw-alias-state-error-primary, #dc2626); background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #dc2626) 10%, transparent); }
      .dp-banner.ok { border-color: var(--dsw-alias-state-success-primary, #16a34a); background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #16a34a) 10%, transparent); }
      .dp-models { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 10px; }
      .dp-model { display: flex; align-items: flex-start; gap: 10px; border: 1px solid var(--dsw-alias-border-l1, #e5e7eb); border-radius: 10px; padding: 10px 12px; }
      .dp-model-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .dp-model-name { font-size: 13.5px; font-weight: 560; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dp-switch { position: relative; display: inline-flex; width: 36px; height: 20px; flex: none; margin-top: 2px; }
      .dp-switch input { opacity: 0; width: 0; height: 0; }
      .dp-switch span { position: absolute; inset: 0; border-radius: 999px; background: var(--dsw-alias-border-l2, #d1d5db); transition: background .15s; cursor: pointer; }
      .dp-switch span::after { content: ''; position: absolute; width: 16px; height: 16px; border-radius: 50%; background: #fff; top: 2px; left: 2px; transition: transform .15s; }
      .dp-switch input:checked + span { background: var(--dsw-alias-state-business-primary, #2563eb); }
      .dp-switch input:checked + span::after { transform: translateX(16px); }
      .dp-switch input:disabled + span { opacity: .5; cursor: default; }
      .dp-log { display: flex; flex-direction: column; gap: 5px; font-size: 13px; }
      .dp-log-row { display: flex; gap: 8px; align-items: baseline; }
      .dp-days { display: flex; flex-wrap: wrap; gap: 5px; }
      .dp-day { font-size: 11.5px; padding: 3px 7px; border-radius: 7px; background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #16a34a) 12%, transparent); color: var(--dsw-alias-state-success-primary, #16a34a); border: 1px solid color-mix(in srgb, var(--dsw-alias-state-success-primary, #16a34a) 30%, transparent); font-variant-numeric: tabular-nums; }
      .dp-day.today { font-weight: 700; box-shadow: 0 0 0 1px var(--dsw-alias-state-success-primary, #16a34a); }
      .dp-time { color: var(--dsw-alias-label-tertiary, #6b7280); font-variant-numeric: tabular-nums; flex: none; width: 86px; }
      .dp-error-text { color: var(--dsw-alias-state-error-primary, #dc2626); }
      .dp-ok-text { color: var(--dsw-alias-state-success-primary, #16a34a); }
      .dp-hint { color: var(--dsw-alias-label-tertiary, #6b7280); font-size: 12px; line-height: 1.6; }
      .dp-inline { display: grid; grid-template-columns: 160px 1fr; gap: 8px; align-items: center; }
      @media (max-width: 640px) { .dp-inline { grid-template-columns: 1fr; } }
    `

    function StyleOnce() {
      const mounted = useRef(false)
      if (!mounted.current) {
        mounted.current = true
      }
      return h('style', { 'data-dumate-provider': '' }, CSS)
    }

    // ── tiny controls ───────────────────────────────────────────────────────
    function Switch({ checked, disabled, onChange, label }) {
      return h('label', { className: 'dp-switch', title: label ?? '' }, [
        h('input', { key: 'i', type: 'checkbox', checked, disabled, onChange: event => onChange(event.target.checked) }),
        h('span', { key: 's' }),
      ])
    }

    function Metric({ label, value, hint }) {
      return h('div', { className: 'dp-card' }, [
        h('div', { key: 'l', className: 'dp-label' }, label),
        h('div', { key: 'v', className: 'dp-metric' }, value),
        hint === undefined ? null : h('div', { key: 'h', className: 'dp-label' }, hint),
      ])
    }

    // ── the page ────────────────────────────────────────────────────────────
    function SettingsPage(props) {
      const { ctx } = props
      const lang = langOf(ctx)
      const t = useCallback((key, vars) => translate(lang, key, vars), [lang])

      const [snapshot, setSnapshot] = useState(undefined)
      const [busy, setBusy] = useState('')
      const [notice, setNotice] = useState(undefined)
      const [draft, setDraft] = useState({ name: '', cookie: '' })
      // undefined = closed, 'choose' = pick a sign-in path, 'browser' = window open, 'paste' = manual form.
      const [addMode, setAddMode] = useState(undefined)
      const [loginState, setLoginState] = useState(undefined)
      const [relogin, setRelogin] = useState(undefined)
      const [apiForm, setApiForm] = useState(false)
      const [apiDraft, setApiDraft] = useState({ label: '', baseURL: '', apiKey: '', models: '' })
      const [pick, setPick] = useState({})
      // Inline rename: the account id being edited and its draft value.
      const [renaming, setRenaming] = useState(undefined)
      const [renameDraft, setRenameDraft] = useState('')
      // A ticking clock so the cooldown countdown actually moves between the
      // 30-second state polls. Only runs while at least one account is parked.
      const [now, setNow] = useState(() => Date.now())

      const call = useCallback(async (path, body) => {
        const response = await fetch(`${API}/${path}`, {
          method: body === undefined ? 'GET' : 'POST',
          headers: body === undefined ? undefined : { 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
          credentials: 'same-origin',
        })
        const payload = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }))
        if (payload.ok !== true) throw new Error(payload.error ?? `HTTP ${response.status}`)
        return payload
      }, [])

      const load = useCallback(async () => {
        try {
          const state = await call('state')
          setSnapshot(state)
        } catch (error) {
          setNotice({ kind: 'err', text: `${t('error')}: ${error.message}` })
        }
      }, [call, t])

      useEffect(() => {
        void load()
        const seconds = Math.max(10, Number(snapshot?.settings?.refreshSeconds) || 30)
        const timer = setInterval(() => { void load() }, seconds * 1000)
        return () => clearInterval(timer)
      }, [load, snapshot?.settings?.refreshSeconds])

      // While any account is parked, advance the clock every second so the
      // countdown ticks instead of freezing until the next state poll.
      useEffect(() => {
        const until = Object.values(snapshot?.cooldowns ?? {}).reduce((max, entry) => Math.max(max, Number(entry?.until) || 0), 0)
        if (until <= Date.now()) return undefined
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(timer)
      }, [snapshot?.cooldowns])

      // Poll the host while the sign-in window is open. The host owns the
      // browser and the cookie jar; this page only shows what it reports.
      useEffect(() => {
        if (addMode !== 'browser') return undefined
        let alive = true
        const tick = async () => {
          try {
            const status = await call('login/status')
            if (!alive) return
            setLoginState(status)
            if (status.state === 'ok') {
              setAddMode(undefined)
              setNotice({ kind: 'ok', text: t('loginOk') })
              await load()
            } else if (status.state === 'error') {
              setNotice({ kind: 'err', text: `${t('loginFailed')}: ${status.error ?? ''}` })
            }
          } catch (error) {
            if (alive) setLoginState({ state: 'error', error: error.message })
          }
        }
        void tick()
        const timer = setInterval(() => { void tick() }, 2000)
        return () => { alive = false; clearInterval(timer) }
      }, [addMode, call, load, t])

      const action = useCallback(async (key, fn) => {
        setBusy(key)
        setNotice(undefined)
        try {
          const result = await fn()
          setNotice(key.startsWith('checkin') ? checkinNotice(result, t) : { kind: 'ok', text: result?.message ?? t('ok') })
          await load()
          return result
        } catch (error) {
          setNotice({ kind: 'err', text: `${t('error')}: ${error.message}` })
          return undefined
        } finally {
          setBusy('')
        }
      }, [load, t])

      if (snapshot === undefined) {
        return h('div', { className: 'dp-root' }, [h(StyleOnce, { key: 's' }), h('div', { key: 'l', className: 'dp-muted' }, '…')])
      }

      const accounts = snapshot.accounts ?? []
      const settings = snapshot.settings ?? {}
      const summary = snapshot.summary ?? {}
      const models = (snapshot.models ?? []).slice().sort((a, b) => (b.enabled === true) - (a.enabled === true))
      const cooling = snapshot.cooldowns ?? {}
      const enabledModels = models.filter(model => model.enabled).length

      const banner = []
      if (summary.lowBalance === true && settings.alertEnabled === true) {
        banner.push(h('div', { key: 'low', className: 'dp-banner warn' }, t('lowBalance', { n: formatPoints(summary.remaining), t: formatPoints(settings.alertThreshold) })))
      }
      if (notice !== undefined) banner.push(h('div', { key: 'n', className: `dp-banner ${notice.kind}` }, notice.text))

      const accountCards = accounts.length === 0
        ? [h('div', { key: 'empty', className: 'dp-muted' }, t('empty'))]
        : accounts.map(account => {
          const checkin = account.checkin ?? {}
          const balance = account.balance ?? {}
          const coolUntil = cooling[account.id]?.until ?? 0
          const coolingNow = coolUntil > now
          const doneToday = checkin.done === true
          const dotClass = account.enabled === false ? 'dp-dot off' : (account.lastError !== '' ? 'dp-dot err' : 'dp-dot')
          return h('div', { key: account.id, className: 'dp-card' }, [
            h('div', { key: 'h', className: 'dp-card-head' }, [
              h('div', { key: 'n', className: 'dp-row', style: { minWidth: 0 } }, [
                h('span', { key: 'd', className: dotClass }),
                renaming === account.id
                  ? h('span', { key: 'edit', className: 'dp-row', style: { minWidth: 0 } }, [
                    h('input', {
                      key: 'i',
                      className: 'dp-input',
                      style: { width: 180, padding: '4px 8px', fontSize: 13 },
                      autoFocus: true,
                      value: renameDraft,
                      onChange: event => setRenameDraft(event.target.value),
                      onKeyDown: event => {
                        if (event.key === 'Enter') {
                          const value = renameDraft.trim()
                          if (value !== '' && value !== account.name) {
                            void action(`rename-${account.id}`, () => call('account/update', { id: account.id, name: value }))
                          }
                          setRenaming(undefined)
                        } else if (event.key === 'Escape') {
                          setRenaming(undefined)
                        }
                      },
                      onBlur: () => {
                        const value = renameDraft.trim()
                        if (value !== '' && value !== account.name) {
                          void action(`rename-${account.id}`, () => call('account/update', { id: account.id, name: value }))
                        }
                        setRenaming(undefined)
                      },
                    }),
                  ])
                  : h('span', { key: 'nameblock', className: 'dp-nameblock', title: t('renameHint') }, [
                    h('span', { key: 'name', className: 'dp-name' }, account.name),
                    h('span', { key: 'sub', className: 'dp-name-sub' }, `账号 ${String(account.id).replace(/^a/, '') || account.id}`),
                  ]),
                renaming === account.id ? null : h('button', {
                  key: 'pen',
                  className: 'dp-icon-btn',
                  title: t('rename'),
                  disabled: busy !== '',
                  onClick: () => { setRenaming(account.id); setRenameDraft(account.name) },
                }, '✎'),
                h('span', {
                  key: 'plan',
                  className: `dp-badge ${planOf(balance, t).tone}`,
                  title: planOf(balance, t).hint,
                }, planOf(balance, t).label),
              ]),
              h(Switch, {
                key: 'sw',
                checked: account.enabled !== false,
                disabled: busy !== '',
                label: t('enable'),
                onChange: enabled => { void action(`toggle-${account.id}`, () => call('account/update', { id: account.id, enabled })) },
              }),
            ]),
            h('div', { key: 'm', className: 'dp-row', style: { justifyContent: 'space-between' } }, [
              h('div', { key: 'b' }, [
                h('div', { key: 'bl', className: 'dp-label' }, t('balance')),
                h('div', { key: 'bv', className: 'dp-metric' }, formatPoints(balance.remaining)),
              ]),
              h('div', { key: 'c', style: { textAlign: 'right' } }, [
                h('div', { key: 'cl', className: 'dp-label' }, t('checkin')),
                h('div', { key: 'cv', className: doneToday ? 'dp-ok-text' : 'dp-muted', style: { fontSize: 12, fontWeight: 550 } },
                  doneToday ? t('already') : t('notYet')),
              ]),
            ]),
            h('div', { key: 'meta', className: 'dp-hint' }, [
              checkin.streak > 0 ? t('streak', { n: checkin.streak }) : '',
              account.hasCookie !== true ? ` · ${t('noCookies')}` : '',
              ` · ${ago(balance.at, t)}`,
              coolingNow ? ` · ${(() => { const n = Math.max(1, Math.ceil((coolUntil - now) / 1000)); const r = String(cooling[account.id]?.reason ?? '').slice(0, 48); return r !== '' ? t('coolReason', { n, r }) : t('cooling', { n }) })()}` : '',
            ].filter(Boolean).join('')),
            account.lastError !== '' ? h('div', { key: 'e', className: 'dp-hint dp-error-text' }, t('lastError', { e: account.lastError })) : null,
            h('div', { key: 'a', className: 'dp-row' }, [
              h('button', {
                key: 'ci',
                className: 'dp-btn small primary',
                disabled: busy !== '' || account.hasCookie !== true,
                onClick: () => { void action(`checkin-${account.id}`, () => call('account/checkin', { id: account.id, force: true })) },
              }, busy === `checkin-${account.id}` ? t('checking') : t('checkin')),
              h('button', {
                key: 'test',
                className: 'dp-btn small',
                disabled: busy !== '' || account.hasCookie !== true,
                onClick: () => { void action(`test-${account.id}`, () => call('account/test', { id: account.id })) },
              }, busy === `test-${account.id}` ? t('testing') : t('test')),
              coolingNow ? h('button', {
                key: 'uncool',
                className: 'dp-btn small',
                disabled: busy !== '',
                onClick: () => { void action(`uncool-${account.id}`, () => call('cooldown/clear', { id: account.id })) },
              }, t('cancelCool')) : null,
              h('button', {
                key: 're',
                className: 'dp-btn small',
                disabled: busy !== '',
                onClick: () => setRelogin({ id: account.id, cookie: '' }),
              }, t('reLogin')),
              h('button', {
                key: 'rm',
                className: 'dp-btn small danger',
                disabled: busy !== '',
                onClick: () => {
                  if (!window.confirm(t('confirmRemove'))) return
                  void action(`rm-${account.id}`, () => call('account/remove', { id: account.id }))
                },
              }, t('remove')),
            ]),
          ])
        })

      return h('div', { className: 'dp-root' }, [
        h(StyleOnce, { key: 'style' }),
        h('div', { key: 'hero', className: 'dp-hero' }, [
          h('div', { key: 't', className: 'dp-title' }, t('title')),
          h('div', { key: 's', className: 'dp-sub' }, `${t('subtitle')} · ${t('version', { v: snapshot.version ?? '' })}`),
        ]),
        banner.length === 0 ? null : h('div', { key: 'banners', className: 'dp-section' }, banner),
        settings.disclaimerAcceptedAt > 0
          ? null
          : h('div', { key: 'disclaimer', className: 'dp-card', style: { borderColor: 'var(--dsw-alias-state-warning-primary, #d97706)' } }, [
            h('div', { key: 't', className: 'dp-section-title' }, t('disclaimerTitle')),
            h('div', { key: 'b', className: 'dp-hint', style: { fontSize: 12.5 } }, t('disclaimerBody')),
            h('div', { key: 'a', className: 'dp-row' }, [
              h('button', {
                key: 'ok',
                className: 'dp-btn primary',
                disabled: busy !== '',
                onClick: () => { void action('disclaimer', () => call('settings', { disclaimerAccepted: true })) },
              }, t('disclaimerAccept')),
            ]),
          ]),
        h('div', { key: 'metrics', className: 'dp-grid' }, [
          h(Metric, { key: 'm1', label: t('accounts'), value: `${summary.enabledCount ?? 0}/${summary.accountCount ?? 0}` }),
          h(Metric, {
            key: 'm2',
            label: t('balance'),
            value: formatPoints(summary.remaining),
            hint: (() => {
              const first = accounts.find(account => account.id === snapshot.accounts?.[0]?.id) ?? accounts[0]
              const plan = planOf(first?.balance, t)
              return plan.label + (plan.hint === t('memberNo') ? '' : ` · ${plan.hint}`)
            })(),
          }),
          h(Metric, {
            key: 'm3',
            label: t('checkin'),
            value: accounts.filter(account => account.checkin?.done === true).length > 0 ? t('already') : t('notYet'),
            hint: summary.balanceAt > 0 ? ago(summary.balanceAt, t) : undefined,
          }),
          h(Metric, { key: 'm4', label: t('models'), value: String(enabledModels) }),
        ]),

        // ── accounts ────────────────────────────────────────────────────────
        h('div', { key: 'accounts', className: 'dp-section' }, [
          h('div', { key: 'h', className: 'dp-row', style: { justifyContent: 'space-between' } }, [
            h('div', { key: 't', className: 'dp-section-title' }, `${t('accounts')} · ${accounts.length}`),
            h('div', { key: 'a', className: 'dp-row' }, [
              h('button', {
                key: 'all',
                className: 'dp-btn small',
                disabled: busy !== '' || accounts.length === 0,
                onClick: () => { void action('checkin-all', () => call('checkin/all', {})) },
              }, busy === 'checkin-all' ? t('checking') : t('checkinAll')),
              h('button', {
                key: 'add',
                className: 'dp-btn small primary',
                disabled: busy !== '',
                onClick: () => {
                  setAddMode(current => (current === undefined ? 'choose' : undefined))
                  setLoginState(undefined)
                },
              }, t('addAccount')),
              h('button', {
                key: 'refresh',
                className: 'dp-btn small',
                disabled: busy !== '',
                onClick: () => { void action('refresh', () => call('balance/refresh', {})) },
              }, busy === 'refresh' ? t('refreshing') : t('refresh')),
            ]),
          ]),
          h('div', { key: 'noapi', className: 'dp-hint' }, t('personalNoApi')),
          addMode === 'choose'
            ? h('div', { key: 'choose', className: 'dp-card' }, [
              h('div', { key: 't', className: 'dp-section-title' }, t('addAccount')),
              h('div', { key: 'h', className: 'dp-hint' }, t('browserLoginHint')),
              h('div', { key: 'a', className: 'dp-row' }, [
                h('button', {
                  key: 'browser',
                  className: 'dp-btn primary',
                  disabled: busy !== '',
                  onClick: () => {
                    setAddMode('browser')
                    setLoginState({ state: 'launching', message: t('waitingLogin') })
                    void action('login-start', async () => {
                      const result = await call('login/start', {})
                      setLoginState(result)
                      return result
                    }).catch(() => {})
                  },
                }, busy === 'login-start' ? t('adding') : t('browserLogin')),
                h('button', {
                  key: 'paste',
                  className: 'dp-btn',
                  onClick: () => setAddMode('paste'),
                }, t('usePaste')),
                h('button', { key: 'cancel', className: 'dp-btn', onClick: () => setAddMode(undefined) }, t('cancel')),
              ]),
            ])
            : addMode === 'browser'
              ? h('div', { key: 'browser', className: 'dp-card' }, [
                h('div', { key: 't', className: 'dp-section-title' }, t('browserLogin')),
                h('div', { key: 'spinner', className: 'dp-row' }, [
                  h('span', {
                    key: 'dot',
                    style: {
                      width: 10, height: 10, borderRadius: '50%', flex: 'none',
                      background: 'var(--dsw-alias-state-business-primary, #2563eb)',
                      animation: 'dp-pulse 1.1s ease-in-out infinite',
                    },
                  }),
                  h('span', { key: 'm' }, loginState?.message ?? t('waitingLogin')),
                ]),
                h('style', { key: 'kf' }, '@keyframes dp-pulse { 0%,100% { opacity: .25 } 50% { opacity: 1 } }'),
                loginState?.error !== undefined
                  ? h('div', { key: 'e', className: 'dp-hint dp-error-text' }, loginState.error)
                  : null,
                h('div', { key: 'h', className: 'dp-hint' }, t('browserLoginHint')),
                h('div', { key: 'a', className: 'dp-row' }, [
                  h('button', {
                    key: 'cancel',
                    className: 'dp-btn',
                    onClick: () => {
                      void call('login/cancel', {}).catch(() => {})
                      setAddMode(undefined)
                      setLoginState(undefined)
                    },
                  }, t('cancelLogin')),
                  h('button', {
                    key: 'paste',
                    className: 'dp-btn',
                    onClick: () => { setAddMode('paste') },
                  }, t('usePaste')),
                ]),
              ])
              : addMode === 'paste'
                ? h('div', { key: 'form', className: 'dp-card' }, [
                  h('div', { key: 'row1', className: 'dp-inline' }, [
                    h('div', { key: 'l1', className: 'dp-label' }, t('name')),
                    h('input', {
                      key: 'i1',
                      className: 'dp-input',
                      value: draft.name,
                      placeholder: t('namePlaceholder'),
                      onChange: event => setDraft({ ...draft, name: event.target.value }),
                    }),
                  ]),
                  h('div', { key: 'row2', className: 'dp-inline' }, [
                    h('div', { key: 'l2', className: 'dp-label' }, t('cookie')),
                    h('textarea', {
                      key: 'i2',
                      className: 'dp-area',
                      value: draft.cookie,
                      placeholder: t('cookiePlaceholder'),
                      onChange: event => setDraft({ ...draft, cookie: event.target.value }),
                    }),
                  ]),
                  h('div', { key: 'hint', className: 'dp-hint' }, t('cookieHint')),
                  h('div', { key: 'actions', className: 'dp-row' }, [
                    h('button', {
                      key: 'submit',
                      className: 'dp-btn primary',
                      disabled: busy !== '' || draft.cookie.trim() === '',
                      onClick: () => {
                        void action('add', async () => {
                          const result = await call('account/add', { name: draft.name, cookie: draft.cookie })
                          setDraft({ name: '', cookie: '' })
                          setAddMode(undefined)
                          return result
                        })
                      },
                    }, busy === 'add' ? t('adding') : t('add')),
                    h('button', { key: 'login', className: 'dp-btn', onClick: () => setAddMode('browser') }, t('backToLogin')),
                    h('button', { key: 'cancel', className: 'dp-btn', onClick: () => setAddMode(undefined) }, t('cancel')),
                  ]),
                ])
                : null,
          h('div', { key: 'list', className: 'dp-grid' }, accountCards),
        ]),

        // ── settings ────────────────────────────────────────────────────────
        h('div', { key: 'settings', className: 'dp-section' }, [
          h('div', { key: 't', className: 'dp-section-title' }, t('checkinSettings')),
          h('div', { key: 'card', className: 'dp-card' }, [
            h('div', { key: 'r1', className: 'dp-row', style: { justifyContent: 'space-between' } }, [
              h('span', { key: 'l' }, t('autoCheckin')),
              h(Switch, {
                key: 's',
                checked: settings.autoCheckin !== false,
                disabled: busy !== '',
                onChange: enabled => { void action('settings-auto', () => call('settings', { autoCheckin: enabled })) },
              }),
            ]),
            h('div', { key: 'hint', className: 'dp-hint' }, t('checkinHint')),
            h('div', { key: 'r2', className: 'dp-inline' }, [
              h('div', { key: 'l', className: 'dp-label' }, t('checkinTime')),
              h('input', {
                key: 'i',
                className: 'dp-input',
                style: { width: 110 },
                defaultValue: settings.checkinTime ?? '09:17',
                onBlur: event => {
                  const value = event.target.value
                  if (value === (settings.checkinTime ?? '09:17')) return
                  void action('settings-time', () => call('settings', { checkinTime: value }))
                },
              }),
            ]),
          ]),
          h('div', { key: 't2', className: 'dp-section-title' }, t('alert')),
          h('div', { key: 'card2', className: 'dp-card' }, [
            h('div', { key: 'r1', className: 'dp-row', style: { justifyContent: 'space-between' } }, [
              h('span', { key: 'l' }, t('alertEnabled')),
              h(Switch, {
                key: 's',
                checked: settings.alertEnabled !== false,
                disabled: busy !== '',
                onChange: enabled => { void action('settings-alert', () => call('settings', { alertEnabled: enabled })) },
              }),
            ]),
            h('div', { key: 'r2', className: 'dp-inline' }, [
              h('div', { key: 'l', className: 'dp-label' }, t('threshold')),
              h('div', { key: 'w', className: 'dp-row' }, [
                h('input', {
                  key: 'i',
                  className: 'dp-input',
                  style: { width: 150 },
                  type: 'number',
                  min: 0,
                  step: 100,
                  defaultValue: settings.alertThreshold ?? 1000,
                  onBlur: event => {
                    const value = Number(event.target.value)
                    if (!Number.isFinite(value) || value === settings.alertThreshold) return
                    void action('settings-threshold', () => call('settings', { alertThreshold: value }))
                  },
                }),
                h('span', { key: 'u', className: 'dp-label' }, t('pointsUnit')),
              ]),
            ]),
            h('div', { key: 'rh', className: 'dp-hint' }, t('thresholdHint', { days: Math.max(0.2, Math.round((Number(settings.alertThreshold ?? 1000) / 200) * 10) / 10) })),
          ]),
          h('div', { key: 'card3', className: 'dp-card' }, [
            h('div', { key: 'r1', className: 'dp-inline' }, [
              h('div', { key: 'l', className: 'dp-label' }, t('cooldown')),
              h('div', { key: 'w', className: 'dp-row' }, [
                h('input', {
                  key: 'i',
                  className: 'dp-input',
                  style: { width: 150 },
                  type: 'number',
                  min: 0,
                  max: 900,
                  step: 10,
                  defaultValue: settings.cooldownSeconds ?? 60,
                  onBlur: event => {
                    const value = Number(event.target.value)
                    if (!Number.isFinite(value) || value < 0 || value === settings.cooldownSeconds) return
                    void action('settings-cooldown', () => call('settings', { cooldownSeconds: value }))
                  },
                }),
                (settings.cooldownSeconds ?? 60) === 0
                  ? h('span', { key: 'off', className: 'dp-badge info' }, t('cooldownOff'))
                  : h('span', { key: 'u', className: 'dp-label' }, 's'),
              ]),
            ]),
            h('div', { key: 'rh', className: 'dp-hint' }, t('cooldownHint')),
          ]),
        ]),

        // ── API lane ────────────────────────────────────────────────────────
        h('div', { key: 'api', className: 'dp-section' }, [
          h('div', { key: 'h', className: 'dp-row', style: { justifyContent: 'space-between' } }, [
            h('div', { key: 't', className: 'dp-section-title' }, t('apiTitle')),
            h('button', {
              key: 'add',
              className: 'dp-btn small',
              disabled: busy !== '',
              onClick: () => setApiForm(value => !value),
            }, t('apiAdd')),
          ]),
          h('div', { key: 'hint', className: 'dp-hint' }, t('apiHint')),
          (snapshot.apiAccounts ?? []).length === 0
            ? null
            : h('div', { key: 'list', className: 'dp-grid' }, (snapshot.apiAccounts ?? []).map(account => h('div', { key: account.id, className: 'dp-card' }, [
              h('div', { key: 'h', className: 'dp-card-head' }, [
                h('div', { key: 'n', className: 'dp-row', style: { minWidth: 0 } }, [
                  h('span', { key: 'd', className: account.enabled === false ? 'dp-dot off' : 'dp-dot' }),
                  h('span', { key: 'name', className: 'dp-name', title: account.baseURL }, account.label),
                  h('span', { key: 'k', className: 'dp-badge muted' }, account.hasKey ? account.keyMask : t('apiNoKey')),
                ]),
                h(Switch, {
                  key: 'sw',
                  checked: account.enabled !== false,
                  disabled: busy !== '',
                  onChange: enabled => { void action(`api-toggle-${account.id}`, () => call('api-account/update', { id: account.id, enabled })) },
                }),
              ]),
              h('div', { key: 'u', className: 'dp-hint', style: { wordBreak: 'break-all' } }, account.baseURL),
              h('div', { key: 'm', className: 'dp-hint' }, t('apiModelCount', { n: (account.models ?? []).length })),
              account.lastError !== '' ? h('div', { key: 'e', className: 'dp-hint dp-error-text' }, account.lastError) : null,
              h('div', { key: 'a', className: 'dp-row' }, [
                h('button', {
                  key: 'test',
                  className: 'dp-btn small',
                  disabled: busy !== '',
                  onClick: () => { void action(`api-test-${account.id}`, () => call('api-account/probe', { id: account.id })) },
                }, busy === `api-test-${account.id}` ? t('apiProbing') : t('apiTest')),
                h('button', {
                  key: 'rm',
                  className: 'dp-btn small danger',
                  disabled: busy !== '',
                  onClick: () => { void action(`api-rm-${account.id}`, () => call('api-account/remove', { id: account.id })) },
                }, t('apiRemove')),
              ]),
            ]))),
          apiForm
            ? h('div', { key: 'form', className: 'dp-card' }, [
              h('div', { key: 'r1', className: 'dp-inline' }, [
                h('div', { key: 'l1', className: 'dp-label' }, t('apiLabel')),
                h('input', {
                  key: 'i1', className: 'dp-input', value: apiDraft.label,
                  placeholder: '企业版',
                  onChange: event => setApiDraft({ ...apiDraft, label: event.target.value }),
                }),
              ]),
              h('div', { key: 'r2', className: 'dp-inline' }, [
                h('div', { key: 'l2', className: 'dp-label' }, t('apiBaseURL')),
                h('input', {
                  key: 'i2', className: 'dp-input', value: apiDraft.baseURL,
                  placeholder: 'https://api.dumate.cn/v1',
                  onChange: event => setApiDraft({ ...apiDraft, baseURL: event.target.value }),
                }),
              ]),
              h('div', { key: 'r3', className: 'dp-inline' }, [
                h('div', { key: 'l3', className: 'dp-label' }, t('apiKeyLabel')),
                h('input', {
                  key: 'i3', className: 'dp-input', type: 'password', value: apiDraft.apiKey,
                  placeholder: 'sk-…', autoComplete: 'off',
                  onChange: event => setApiDraft({ ...apiDraft, apiKey: event.target.value }),
                }),
              ]),
              h('div', { key: 'r4', className: 'dp-inline' }, [
                h('div', { key: 'l4', className: 'dp-label' }, t('apiModelsLabel')),
                h('textarea', {
                  key: 'i4', className: 'dp-area', value: apiDraft.models,
                  placeholder: 'deepseek-v4-pro\nglm-53,GLM-5.3',
                  onChange: event => setApiDraft({ ...apiDraft, models: event.target.value }),
                }),
              ]),
              h('div', { key: 'actions', className: 'dp-row' }, [
                h('button', {
                  key: 'probe', className: 'dp-btn', disabled: busy !== '' || apiDraft.baseURL.trim() === '',
                  onClick: () => {
                    void action('api-probe', async () => {
                      const result = await call('api-account/probe', { baseURL: apiDraft.baseURL, apiKey: apiDraft.apiKey })
                      if (result.ok !== true) throw new Error(result.error ?? '探测失败')
                      const ids = (result.models ?? []).map(model => model.id).join('\n')
                      if (ids !== '') setApiDraft(current => ({ ...current, models: ids }))
                      return { message: t('apiProbeOk', { n: (result.models ?? []).length }) }
                    })
                  },
                }, busy === 'api-probe' ? t('apiProbing') : t('apiProbe')),
                h('button', {
                  key: 'save', className: 'dp-btn primary',
                  disabled: busy !== '' || apiDraft.baseURL.trim() === '',
                  onClick: () => {
                    void action('api-save', async () => {
                      const result = await call('api-account/add', {
                        label: apiDraft.label,
                        baseURL: apiDraft.baseURL,
                        apiKey: apiDraft.apiKey,
                        models: parseModelLines(apiDraft.models),
                      })
                      setApiDraft({ label: '', baseURL: '', apiKey: '', models: '' })
                      setApiForm(false)
                      return result
                    })
                  },
                }, busy === 'api-save' ? t('apiSaving') : t('apiSave')),
                h('button', { key: 'cancel', className: 'dp-btn', onClick: () => setApiForm(false) }, t('cancel')),
              ]),
            ])
            : null,
        ]),

        // ── models ──────────────────────────────────────────────────────────
        h('div', { key: 'models', className: 'dp-section' }, [
          h('div', { key: 'h', className: 'dp-row', style: { justifyContent: 'space-between' } }, [
            h('div', { key: 't', className: 'dp-section-title' }, `${t('models')} (${enabledModels}/${models.length})`),
            h('div', { key: 'a', className: 'dp-row' }, [
              h('button', {
                key: 'on',
                className: 'dp-btn small',
                disabled: busy !== '',
                onClick: () => { void action('models-on', () => call('models', { all: true, enabled: true })) },
              }, t('enableAll')),
              h('button', {
                key: 'off',
                className: 'dp-btn small',
                disabled: busy !== '',
                onClick: () => { void action('models-off', () => call('models', { all: true, enabled: false })) },
              }, t('disableAll')),
            ]),
          ]),
          h('div', { key: 'hint', className: 'dp-hint' }, t('modelsHint')),
          h('div', { key: 'grid', className: 'dp-models' }, models.map(model => h('div', { key: model.id, className: 'dp-model' }, [
            h(Switch, {
              key: 's',
              checked: model.enabled === true,
              disabled: busy !== '',
              onChange: enabled => { void action(`model-${model.id}`, () => call('models', { id: model.id, enabled })) },
            }),
            h('div', { key: 'm', className: 'dp-model-main' }, [
              h('div', { key: 'n', className: 'dp-model-name', title: model.id }, model.label ?? model.id),
              h('div', { key: 'd', className: 'dp-label' }, [
                t('context', { n: formatTokens(model.context) }),
                t('output', { n: formatTokens(model.maxOutput) }),
                model.vision === true ? t('vision') : '',
              ].filter(Boolean).join(' · ')),
            ]),
          ]))),
        ]),

        // ── check-in record ─────────────────────────────────────────────────
        h('div', { key: 'logs', className: 'dp-section' }, [
          h('div', { key: 't', className: 'dp-section-title' }, t('logs')),
          (() => {
            const days = new Set()
            for (const account of accounts) for (const day of account.checkin?.days ?? []) days.add(day)
            const sorted = [...days].sort()
            const nameOf = id => accounts.find(account => account.id === id)?.name ?? id
            return [
              sorted.length === 0
                ? h('div', { key: 'dn', className: 'dp-muted', style: { fontSize: 12 } }, t('checkinDaysNone'))
                : h('div', { key: 'd', className: 'dp-days' }, sorted.slice(-40).map(day => h('span', {
                  key: day,
                  className: day === snapshot.beijingDate ? 'dp-day today' : 'dp-day',
                  title: day,
                }, day.slice(5)))),
              sorted.length > 0 ? h('div', { key: 'dh', className: 'dp-hint' }, t('checkinDaysHint', { n: sorted.length })) : null,
              h('div', { key: 'a', className: 'dp-log', style: { marginTop: 8 } },
                (snapshot.runs ?? []).length === 0
                  ? h('div', { key: 'none', className: 'dp-muted' }, t('noLogs'))
                  : (snapshot.runs ?? []).slice().reverse().slice(0, 12).map((run, index) => h('div', { key: `${run.at}-${index}`, className: 'dp-log-row' }, [
                    h('span', { key: 't', className: 'dp-time' }, new Date(run.at).toLocaleString()),
                    h('span', { key: 'a', className: 'dp-muted' }, run.name ?? nameOf(run.accountId)),
                    h('span', { key: 'm', className: run.ok === true ? 'dp-ok-text' : 'dp-error-text' }, run.message ?? ''),
                  ]))),
            ].filter(Boolean)
          })(),
        ]),

        relogin === undefined ? null : h('div', {
          key: 'modal',
          style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 },
          onClick: event => { if (event.target === event.currentTarget) setRelogin(undefined) },
        }, h('div', { className: 'dp-card', style: { width: 520, maxWidth: '100%', background: 'var(--dsw-alias-bg-layer-1, #fff)' } }, [
          h('div', { key: 't', className: 'dp-section-title' }, t('reLogin')),
          h('textarea', {
            key: 'area',
            className: 'dp-area',
            value: relogin.cookie,
            placeholder: t('cookiePlaceholder'),
            onChange: event => setRelogin({ ...relogin, cookie: event.target.value }),
          }),
          h('div', { key: 'hint', className: 'dp-hint' }, t('cookieHint')),
          h('div', { key: 'row', className: 'dp-row', style: { justifyContent: 'flex-end' } }, [
            h('button', { key: 'c', className: 'dp-btn', onClick: () => setRelogin(undefined) }, t('cancel')),
            h('button', {
              key: 's',
              className: 'dp-btn primary',
              disabled: busy !== '' || relogin.cookie.trim() === '',
              onClick: () => {
                void action('relogin', async () => {
                  const result = await call('account/login', { id: relogin.id, cookie: relogin.cookie })
                  setRelogin(undefined)
                  return result
                })
              },
            }, busy === 'relogin' ? t('adding') : t('save')),
          ]),
        ])),
      ])
    }

    function apply(ctx) {
      const label = () => translate(langOf(ctx), 'nav')
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: NS,
        order: 33,
        label,
        locale: NS,
      }, props => h(SettingsPage, { ...props, ctx })))
    }

    exports.apply = apply
    exports.inject = inject
    exports.name = 'dumate-provider'
    // Test seam: the pure projections are exercised without a browser.
    exports.__test = { planOf, translate, checkinNotice }
    return module.exports
  },
})
