# Changelog

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
