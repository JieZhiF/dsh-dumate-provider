# Changelog

## 1.5.0 — 2026-11-19

- **npm 发布走 CI**：`.github/workflows/publish.yml`，推 `v*` tag 触发，校验 tag
  与 `package.json` 版本一致 → `npm run check` → `npm test` →
  `npm publish --provenance`。用于 npmjs.com 网页被 Cloudflare 拦、但 registry
  可达的网络；发版流程写进 `PUBLISHING.md`。

- **dsh-go 原生界面**：同一个包现在也带手机端（`package.json` → `dshGo`）。
  输入框上方一条余额 / 签到状态条；面板「百度搭子」管账号（签到、启用停用、
  删除二次确认、刷新）；面板「模型开关」管 22 个模型；两个胶囊
  「贴搭子Cookie」「搭子签到」。手机没有可驱动的桌面浏览器，所以浏览器登录
  仍然只给桌面版，手机走「复制 Cookie → 点胶囊」。
- **一套 handler，两种通道**：`src/routes.js` 拆出 `createHandlers()`，HTTP
  设置页和原生面板共用同一张路由表（`invoke()` 走进程内调用，不走 socket、
  不过网络信任栅栏）。网页版行为不变。
- **服务依赖下沉**：去掉顶层 `inject: ['llm','timer']`，改成 `ctx.inject`
  分别等 `llm` / `timer` / `dshGo`。带桥接但没有 LLM 注册表的宿主也能加载
  原生半边，官方 dsh-go 插件检查器也能直接加载这个包。
- **面板内添加账号**：App 能画 v2 表单时，「百度搭子」面板里直接给一个
  多行 Cookie 输入框（`bind: data.cookie`，提交即 `POST /account/add`）；
  画不了就用输入框上方的「贴搭子Cookie」胶囊。面板加 `plugin` 位置，插件
  自己的入口也能进原生面板。
- **登录页换成能出登录表单的那条**：`login.bce.baidu.com` 用
  `www.dumate.cn/app` 当 redirect 时不会给登录表单；改成落回
  `cloud.baidu.com/product-s/dumate_developement_platform.html`。桌面版
  「用浏览器登录」和手机面板的「打开登录页」都走这一条。
- 面板里加「打开登录页」按钮和一句说明；删掉不会真读剪贴板的「用剪贴板」
  按钮（点了只会提示去输入框，属于误导）。
- **加完账号立刻有数**：添加成功后先跑一次余额刷新，再让面板重取视图；
  不用关掉面板再打开。
- **签到记录进面板**：最近 5 条 `runs`（时间、账号、结果）显示在面板里。
- **签到结果说人话**：已签到显示「今日已签到，不用再签」，不再「签到成功 +0」；
  多个账号按「+N 积分 / X 个今日已签 / Y 个失败」汇总。
- **删掉面板里的 Cookie 输入框**：App 把表单字段限到 256 字，整段 Cookie
  根本放不下（Via 的 Cookies 弹窗只能整段复制）。改为提示「复制 → 点输入框
  上方的『贴搭子Cookie』」，胶囊读剪贴板没有长度限制，解析时只认 `BDUSS`。
- **表单取值再放宽**：回传是数组、`formData`、或任意未知字段时，递归找
  `name=value` 串；Cookie 输入框去掉 2000 字上限（整段 Cookie 会被截断），
  提示里说明只粘 `BDUSS=…` 也够。取不到值时提示里带上回传字段名，便于定位。
- **修 500**：`picked` 在声明前被引用（TDZ），导致面板上**所有**按钮都
  返回 `handler failed`，App 表现就是「点一下转圈，然后没了」。已加
  `test/native-actions.test.js` 用 dsh-go 测试宿主直接跑一遍所有动作，防回归。
- 处理函数加了兜底：真出错时回一句「操作失败，请稍后再试」，不再静默。
- **视图兜底**：面板的 view 包了一层 try/catch，渲染出错只显示一行错误，
  不再把异常抛给桥接。
- **防连点**：「打开登录页」5 秒内重复点只回一句「登录页已经打开了」，
  不再连续发浏览器 intent（连点会让 App 前后台反复切换，本机引擎跟着停/起）。
- 表单提交的取值兼容 App 的几种回传结构（`{cookie}` / `{data:{cookie}}` /
  `{value:{cookie}}` / 纯字符串），修掉粘贴后提示「没有这个操作」；同时避免
  `options` 的选择值被误当成 Cookie。
- 新增 `test/native.test.js`（状态条长度、面板结构、删除二次确认、22 个开关、
  表单按能力出现、进程内调用）。

## 1.4.1 — 2026-11-19

- **Section order**: 签到记录 and 会话消耗 now sit above the API lane.
- **GitHub link + Star button** in the page header, pointing at
  `github.com/JieZhiF/dsh-dumate-provider` (opens in a new tab).

## 1.4.0 — 2026-11-18

- **Per-session point consumption.** DuMate bills anonymously (every usage
  record has an empty `conversationId`), so the plugin attributes charges by
  time window: each turn records when it started, and after it ends reads the
  charges stamped inside that window and folds them into the session's running
  total. Every charge is fingerprinted and counted **once, ever**, so
  overlapping windows never double-count. A "会话消耗" section on the settings
  page lists recent sessions with their charged points; a refresh re-scans to
  catch a charge the upstream stamped a few seconds late. Verified live: an
  older window attributed 13 rows / 75.77 points, and a re-scan added 0.

## 1.3.1 — 2026-11-18

- **The "取消冷却" button is always visible**, greyed and inert when the
  account is not cooling, so its presence is stable instead of appearing and
  disappearing.
- **Nickname adoption now follows the refresh tick** instead of a one-shot 8s
  timer: each scheduler pass adopts the Baidu nickname for any account still on
  a placeholder label. A custom or already-named account is skipped with no
  network call, so a user's own label is never overwritten.

## 1.3.0 — 2026-11-18

- **Accounts are named by who they are.** Adding an account without a label
  now defaults to the Baidu nickname behind the cookie (`GET
  /api/dumate/user/info` → `displayName`, e.g. 沁染节制), falling back to
  `搭子账号 N` only when the identity call fails. Both the manual-cookie and
  browser sign-in paths use it.
- **Inline rename.** Each account card shows the name with a small
  `账号 N` line beneath it and a ✎ button; click it to set a custom label.
- **Account count** now appears in the section header ("账号 · 3").

## 1.2.2 — 2026-11-18

- **Cooldown is now a setting, and 0 turns it off.** A new "失败冷却（秒）"
  field on the settings page sets the backoff start (default 60; doubling per
  repeat failure, capped at 15 minutes). Entering `0` disables the mechanism
  completely — accounts are never parked and every request retries
  immediately; the last failure reason still shows on the card.
- **The countdown ticks.** The cooldown seconds now count down live once a
  second instead of freezing between the 30-second state polls.
- **A "取消冷却" button** clears one account's cooldown on the spot.
- **The "no account" error was wrong and is fixed.** When accounts exist but
  are all parked, the message no longer says "go paste a cookie" — it names
  the remaining seconds, the last failure reason, and points at the cooldown
  setting to shorten or disable it.

## 1.2.1 — 2026-11-18

- **Check-in record is no longer empty.** Two fixes: a successful check-in now
  writes an entry to the action log (only failures used to be logged, so
  everyday success left the record blank), and the upstream `signInDays` list —
  the real check-in calendar, including days claimed outside this plugin — is
  now persisted on every status read and rendered as date chips with the
  streak total. Repeat clicks that claim nothing do not spam the log.
- The record shows account names instead of internal ids.

## 1.2.0 — 2026-11-18

- **Reasoning effort is now selectable.** Five DuMate models that run the
  `deepseek-v4.1-flash-low-latency` backend (`DeepSeek V4.1 Flash`, `model-text`,
  and the auto tiers `text.L0` / `mm.L0` / `mm.L2`) advertise an
  Off / Low / High / Max menu in the model picker, using the same four-tier
  ladder the live gateway honors (verified 2026-11-13). `off` sends an explicit
  `thinking:{type:'disabled'}` + `enable_thinking:false` — omitting the switch
  still thinks upstream — and `low` is normalized to `high` because the Baidu
  channel runs them at identical strength. Models on other backends advertise
  no menu, so the picker never offers something the upstream would drop. No
  default effort is forced, so an unselected model behaves exactly as before.

## 1.1.3 — 2026-11-18

- **Browser sign-in fixed**: `login/start` and `login/cancel` were called
  without a body, so the page sent them as GET and the host answered
  `unknown route`. They now post `{}` like every other action.

## 1.1.2 — 2026-11-18

- The account card now shows *why* an account is cooling down (the last
  upstream failure), not just the countdown — e.g. `冷却中（42 秒）：HTTP 429`.

## 1.1.1 — 2026-11-18

- **Check-in no longer reports a false success.** The claim endpoint answers
  `success` even when today was already claimed, so clicking repeatedly used to
  show a green "checked in" toast every time while nothing was granted. The
  service now reads the live status first and only POSTs the claim when today is
  genuinely unclaimed; an already-claimed day returns `already: true` with no
  POST, and a claim that grants nothing says "no points detected". The granted
  amount is measured from the cumulative grant counter, which chat consumption
  never touches; a stale counter is caught by the sign-in day flip plus the
  upstream toast, so a real grant is never reported as a failure. The settings
  page grades the result — green only for a real grant, neutral for
  already-claimed / no-points, red for failures — and the "Check in all" button
  summarizes per-account outcomes. Verified live: an already-claimed account now
  produces zero POSTs to the claim endpoint.
- Wording: the plugin serves **any personal account (free / Pro / Max)**, not
  only a paid membership; the "no API for the personal tier" notice now reads
  against the enterprise API lane rather than implying a paywall.
- README gains English/简体中文 cross-links.

## 1.1.0 — 2026-11-17

- **API lane**: a second provider route (`dumate-api`) for OpenAI-compatible endpoints (enterprise plan, company gateway, self-hosted relay). Base URL + API key + model list, with a "probe models" button that reads `GET /models`. These models appear in their own group, with no cookie and no point spending.
- Catalog changes (model switches, API endpoints) now announce `llm/adapters-updated` / `llm/models-updated` so a 0.2.2 picker refreshes without reopening.
- HTTP endpoints are supported alongside HTTPS, so self-hosted gateways on `127.0.0.1` work.

## 1.0.2 — 2026-11-17

- Accounts now show their membership plan (`Pro` / `Max` / `Free`) derived from the active `plan_*` package, with the expiry date.
- The settings page shows a risk notice until acknowledged; it is persisted in the plugin state.
- Documentation gains a risk & disclaimer section and an official-API path (enterprise `api.dumate.cn`) with links.

## 1.0.1 — 2026-11-17

- **Browser sign-in**: "添加账号" can now open a throwaway Chrome/Edge window, read the httpOnly cookie jar over CDP once the user signs in, validate it and add the account — no manual copy-paste. Works with the Windows browser from WSL (mirrored loopback).
- **Wider host support**: `engines.dsh` now covers the 0.1.7 line (verified on 0.1.7-rc.2) as well as 0.2.0–0.2.2. Stable 0.1.8/0.1.9 releases fall in range when they ship.
- **Check-in accounting corrected**: the plugin claims the WEB check-in only (+200/day). The other 300 is a desktop-client grant and is not reachable from the web cookie; copy and the threshold hint now say so.
- **Alert default** is 1000 points (= 5 days of web check-in, one third of the 3,000-point trial grant), shown with its unit in the settings page.
- Settings page typography and controls enlarged.

## 1.0.0 — 2026-11-17

- First release: native `dumate` provider with the 22-model catalog, streaming, tool calls and reasoning passthrough.
- Web-cookie credential chain (Cookie → token → gateway) with a per-account token cache, 401 refresh and host failover.
- Settings page: accounts (add / rename / enable / remove / sign in again / test), balance by package, daily check-in, per-model switches, balance alert threshold.
- Multi-account pool with cooldown and automatic failover.
- Automatic daily check-in at a configured Beijing time, idempotent with the upstream endpoint.
- Compatible with DSH 0.2.1 line and 0.2.2 (incl. 0.2.2-rc.3); no runtime `@deepseek-ai/*` imports.
