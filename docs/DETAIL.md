# Baidu DuMate

A native DSH provider for Baidu DuMate personal accounts (free, Pro or Max). Models appear in the model picker, and accounts, balance, daily check-in and per-model switches live on one settings page.

## What it does

- **Models in the picker**: registers the `dumate` provider with 22 models (DeepSeek V4 Pro / V4.1 Flash, Kimi K3 / K3.1, GLM-5.3, Qwen 3.8 Max, Doubao Seed 2.0, ERNIE 4.5 VL, the `dm-auto-model` L0–L2 auto tiers) under one **Baidu DuMate** group.
- **Cookie to gateway, directly**: web cookie → short-lived token → the OpenAI-compatible `dumate-svc.baidu.com` endpoint. No local gateway process, no extra port, no second copy of the credential.
- **Streaming, tool calls, reasoning**: SSE is decoded with `StringDecoder` (multi-byte characters never corrupt across chunks), `tool_calls` deltas are assembled into `tool-calls` blocks, and `reasoning_content` goes to reasoning blocks instead of the visible text.
- **Browser sign-in**: "Add account" → "Sign in with a browser" opens a separate Chrome/Edge window (your own browser stays untouched); after signing in, the plugin reads the httpOnly cookie jar over the DevTools protocol and stores the account. Manual paste remains available.
- **Multiple accounts**: priority order, per-account cooldown, automatic failover; a 401 refreshes the token once before the cookie is declared dead.
- **Daily check-in**: a manual button plus an automatic run at 09:17 Beijing time (configurable). The endpoint is idempotent, so a repeated run never double-credits. **The plugin claims the web check-in only (+200/day)**; the other 300 is a desktop-client grant that must be claimed in the DuMate desktop app.
- **Balance**: per-package breakdown (membership, check-in grants, event points), a configurable alert threshold (default 1000 points ≈ 5 days of web check-in), a banner on the page and a warning in the log when the balance dips.
- **Model switches**: a disabled model disappears from the picker immediately; a session locked to it reports a readable error.

## Usage

1. Sign in at <https://www.dumate.cn/app>. It redirects to `login.bce.baidu.com` — DuMate reuses Baidu Cloud SSO, so that is expected.
2. DevTools → Application → Cookies → `www.dumate.cn`, copy the `Cookie` request header (or the whole table as JSON). `BDUSS` is httpOnly, so `document.cookie` cannot read it.
3. DSH → Settings → Baidu DuMate → add account, paste, validate.
4. Pick a model under the Baidu DuMate group in the model picker.

## API endpoint (optional)

The settings page ends with an "API endpoint" section: a base URL (up to `/v1`) plus an API key. "Probe models" asks `GET {baseURL}/models` and fills the list; models can also be typed by hand (`id` or `id,label` per line). Once saved:

- those models appear in a separate **"Baidu DuMate · API"** group in the picker, with no cookie, no point spending, and no check-in/balance;
- any OpenAI-compatible endpoint works (enterprise plan, a company gateway, a self-hosted relay);
- an endpoint that is *not* OpenAI-compatible (an agent-shaped API only) needs `src/adapter-api.js` adapted to its protocol.

## Risk and disclaimer

- **Unofficial integration**: this plugin calls DuMate's web endpoints directly. It is not a Baidu-supported integration, may conflict with the terms of service, may trip risk controls, and in the worst case the account can be restricted or banned. Use it at your own risk.
- **Credentials**: only the web cookie is stored (local `$DSH_HOME/dumate-provider/state.json`, mode 0600). No password. A cookie is a live session — do not share that file.
- **Quota**: points are spent per turn at model-specific rates; check-in only tops them up.
- **No warranty**: the upstream service can change or close these endpoints at any time; the plugin is provided as-is.

## If you can use the official API

The personal tier has no API; the **enterprise** tier has an official Agent API (`api.dumate.cn`, API-key auth, SSE and tool calls). If you can enable it, prefer the official API over cookie scraping:

- [Enterprise API quick start](https://cloud.baidu.com/doc/Dumate/s/Mmtv8sxf3)
- [Authentication (create an API key)](https://cloud.baidu.com/doc/Dumate/s/umtl6r27w)
- [Create an agent](https://cloud.baidu.com/doc/Dumate/s/Gmtim7rk4)
- [Enterprise contact](https://cloud.baidu.com/survey/dumate_enterprise_services.html)

In DSH the official API fits the generic OpenAI-compatible provider (`llm-pi-ai`) with a `baseURL` and `apiKey`, side by side with this plugin's cookie lane — each can serve a different class of account.

## Limits and accounting

- The personal tier has **no API key and no OAuth**; only a web cookie works. That is why "browser sign-in" drives a controlled browser: httpOnly cookies are readable only through the DevTools protocol.
- Points are spent per message (rates differ by model) and the daily check-in only tops them up — this is **not an unlimited quota**.
- The raw `quota_overview.totalPoints` folds in other Baidu products (e.g. `comate`) and unactivated future packages. This plugin counts only `product === "dumate"` packages that are still active, so its number can be lower than the website's. That is an accounting difference, not a missing package.
- Images: a vision model receives a `[图片]` placeholder in this version (no attachment byte projection yet); text and tool calls are unaffected.
- `dm-auto-model/*` tier codes live in the model name (`text.L1`); the slash is not a channel separator and the full name is passed through.

## Compatibility

- DSH `0.1.7` line (verified on `0.1.7-rc.2`), `0.2.0`–`0.2.2` (including `0.2.2-rc.3`); stable `0.1.8`/`0.1.9` fall in range when published.
- The Host half imports no `@deepseek-ai/*` package: the adapter implements the contract structurally, so there is no peer-version matrix to satisfy.
