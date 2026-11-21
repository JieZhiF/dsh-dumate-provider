# dsh-dumate-provider · Baidu DuMate

**English** | [简体中文](./README.zh.md)

Native DeepSeek Harness (DSH) plugin: connects a **Baidu DuMate account** (free, Pro or Max) as a provider. Models appear in the model picker; accounts, balance, daily check-in and per-model switches live on one settings page.

- 22 models (DeepSeek V4 Pro / V4.1 Flash, Kimi K3 / K3.1, GLM-5.3, Qwen 3.8 Max, Doubao Seed 2.0, ERNIE 4.5 VL, the `dm-auto-model` L0–L2 tiers, …)
- Cookie → `dumate-svc.baidu.com` directly: no local gateway, no extra port
- Streaming, tool calls and reasoning blocks; SSE decoded with `StringDecoder` so Chinese text never corrupts across chunks
- Multi-account pool with cooldown and failover; a 401 refreshes the token before the cookie is declared dead
- Automatic daily check-in at 09:17 Beijing time, per-package balance with a configurable alert, per-model switches
- Compatible with the DSH **0.1.7** line (verified on 0.1.7-rc.2), **0.2.0–0.2.2** (incl. rc.3); the Host half imports no `@deepseek-ai/*` package, so there is no peer-version matrix

## Install

Pick one. Restart DSH afterwards — a new provider is registered into the model catalog at startup.

**Plugin market (recommended)**: DSH sidebar → Plugin market → search “DuMate” or “搭子” → install.
If it is not listed yet, use one of the direct paths below.

**GitHub**:

```bash
dsh plugin --profile web add github:JieZhiF/dsh-dumate-provider
```

**Release tarball** (no npm account needed):

```bash
dsh plugin --profile web add https://github.com/JieZhiF/dsh-dumate-provider/releases/download/v1.5.0/dsh-dumate-provider-1.5.0.tgz
```

**npm**:

```bash
dsh plugin --profile web add dsh-dumate-provider
```

**Local directory** (development):

```bash
dsh plugin --profile web add /home/viola/dumate-provider
```

## On the phone (dsh-go)

One package, two faces. Desktop / Web UI keeps the settings page; the Android **dsh-go** app gets native panels from the same install:

- A composer strip with the balance and today's check-in state; tap it to open the panel
- Panel **Baidu DuMate**: one block per account (state / balance / check-in) with check-in, enable/disable, delete (two taps), refresh and check-in-all buttons
- Panel **Models**: the 22 per-model switches, plus all-on / all-off
- Composer actions: **Add cookie** (reads the clipboard, verifies, stores) and **Check in**

There is no Chrome/Edge to drive on Android, so "sign in with a browser" stays desktop-only; on the phone you sign in at www.dumate.cn in a browser, copy the Cookie header, then tap the action. The clipboard is read only at that tap.

The native half registers only when the Host runs the dsh-go bridge; the web settings page is unchanged. Both read the same state file (`$DSH_HOME/dumate-provider/state.json`).

## Usage

1. DSH → Settings → Baidu DuMate → Add account → **Sign in with a browser**: a separate browser window opens; sign in there and the account is added automatically. (Manual paste still works: DevTools → Application → Cookies → `www.dumate.cn`.)
2. Pick a model under the Baidu DuMate group.

## Configuration

The settings page covers: automatic check-in switch and time (Beijing), balance alert switch and threshold, the 22 per-model switches, and account label / enable / remove / sign in again.

Plugin state lives in `$DSH_HOME/dumate-provider/state.json` (default `~/.dsh/dumate-provider/state.json`, mode 0600, carries cookies). It is not written into the profile's `cordis.patch.yml` and not the plugin row's `config`: toggling a model must not restart the plugin.

## API endpoint (optional)

With an enterprise plan or any OpenAI-compatible endpoint, use the "API endpoint" section at the bottom of the settings page: base URL + key, then "Probe models". Those models appear under "Baidu DuMate · API", independent of the cookie lane.

## Risk notice

This is an **unofficial** integration: it calls DuMate's web endpoints with your cookie, which may conflict with the terms of service and trip risk controls (an account can be restricted). Points are spent per turn and check-in only tops them up. The plugin stores only the cookie, locally with mode 0600 — never your password.

The enterprise tier has an official API (`api.dumate.cn`, API key + SSE + tool calls); a generic OpenAI-compatible provider is the safer route when you can use it. See [DETAIL](docs/DETAIL.md).

## Limits

- Personal accounts — free, Pro or Max — all work: DuMate issues no API key for them, so a web cookie is the only credential. Enterprise API keys go through the built-in `dumate-api` lane.
- Points are spent per message and the daily check-in only tops them up — not an unlimited quota. The plugin claims the **web** check-in (+200/day); the PC client's extra 300 must be claimed in the desktop app.
- Balance counts only active `product === "dumate"` packages, which can differ from the website's `totalPoints`.
- Vision models accept image input (`image_url` data URLs, up to 1 MiB per image, 8 images and 4 MiB total per request; oversized or unreadable attachments degrade to a text placeholder); text-only models receive an explicit text placeholder.

## Sister projects

These projects talk to the same upstream from other angles; several design
choices here were informed by them:

| Project | What it does |
|---|---|
| [wearetheone777/dumate2api](https://github.com/wearetheone777/dumate2api) | DuMate / Qianfan Office / TRAE Work / Qoder → OpenAI, Anthropic and Google gateways |
| [R227BOUT/magpie-dumate](https://github.com/R227BOUT/magpie-dumate) | DuMate personal points into Magpie; cross-platform sign-in and expiring-points display |
| [RanceLee233/dumate-rance](https://github.com/RanceLee233/dumate-rance) | cross-platform sign-in state, model discovery and persistence |
| [Alphaxiaoteng/dumate2api](https://github.com/Alphaxiaoteng/dumate2api) | an OpenAI-compatible reverse proxy |

**magpie-dumate**'s published troubleshooting notes (never guess the real
install location, keep display names and real API ids apart, verify uninstall
independence with a fresh process, and "if you have not measured it, do not
write it down as passing") shaped this plugin's own verification standard.

## Development

```bash
npm run check   # syntax check every module
npm test        # node:test (cookie normalization / message mapping / usage mapping / SSE frames)
```

Layout: `index.js` (Host apply), `client.js` (settings page), `src/` (adapter / wire / auth / api / pool / store / checkin / balance / routes / fence), `locale/` (plugin page metadata), `docs/DETAIL*.md` (detail pages).

## License

MIT
