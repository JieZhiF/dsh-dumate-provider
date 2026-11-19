/**
 * "Sign in with a browser" account intake.
 *
 * DuMate's personal tier has no OAuth or API-key flow, and the cookies that
 * matter (`BDUSS`, `bce-user-info`) are httpOnly — a page script cannot read
 * them, so the settings page cannot do this itself. The Host can: it launches a
 * throwaway browser profile pointed at the login page, talks to it over the
 * DevTools protocol, and reads the cookie jar once the user finishes signing in.
 * CDP is the only reader that sees httpOnly cookies.
 *
 * No dependency: the protocol is a few JSON-RPC calls over the global
 * `WebSocket` (Node 22+), and the browser is whatever Chrome/Edge/Brave is
 * already installed — including the Windows build when running under WSL, where
 * `networkingMode=mirrored` makes its debugging port reachable on 127.0.0.1.
 *
 * @module src/browser-login
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { normalizeCookie, validateCookie, cookieValue } from './cookie.js'
import { userInfo } from './api.js'

const execFileAsync = promisify(execFile)

/**
 * Where the sign-in flow starts.
 *
 * DuMate reuses Baidu Cloud SSO, but `www.dumate.cn/app` is not an authorized
 * redirect target: the SSO page comes back without a login form. The DuMate
 * product page on cloud.baidu.com is, so the whole flow stays on one origin
 * and the resulting `BDUSS` lands on `.baidu.com` either way — which is all the
 * plugin reads.
 */
const CLOUD_PRODUCT = 'https://cloud.baidu.com/product-s/dumate_developement_platform.html'
export const LOGIN_URL = `https://login.bce.baidu.com/?redirect=${encodeURIComponent(CLOUD_PRODUCT)}&cloudUrl=${encodeURIComponent(CLOUD_PRODUCT)}`

/** How long a session waits for the user to finish signing in. */
const SESSION_TIMEOUT_MS = 5 * 60 * 1000

/** Cookie polling cadence. */
const POLL_MS = 2000

/** Domains whose cookies compose the DuMate session. */
const COOKIE_DOMAIN = /(^|\.)(baidu\.com|dumate\.cn)$/i

/** Windows install locations, checked from WSL. */
const WINDOWS_BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
]

/** Linux binaries, in preference order. */
const LINUX_BROWSERS = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'brave-browser']

/** Translate `C:\…` into the WSL path that exists on this filesystem. */
function windowsPathToWsl(winPath) {
  const match = /^([A-Za-z]):\\(.*)$/.exec(winPath)
  if (match === null) return undefined
  return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, '/')}`
}


/**
 * Choose a throwaway profile directory the browser can actually use.
 *
 * Chrome refuses a UNC path as `--user-data-dir`, so under WSL the directory
 * must live on the Windows side of the boundary; we create it in the Windows
 * temp directory and hand the native path to the browser. Linux browsers get a
 * plain temp directory.
 *
 * @param {{platform:string}} browser
 * @returns {Promise<{dir:string, arg:string}>} `dir` is a WSL-side path used for
 *   cleanup, `arg` is what the browser receives.
 */
async function profileDirFor(browser) {
  if (browser.platform !== 'windows') {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'dumate-login-'))
    return { dir, arg: dir }
  }
  try {
    const { stdout } = await execFileAsync('cmd.exe', ['/c', 'echo %TEMP%'])
    const winTemp = stdout.trim()
    const wslTemp = (await execFileAsync('wslpath', ['-u', winTemp])).stdout.trim()
    const dir = await mkdtemp(path.join(wslTemp, 'dumate-login-'))
    const arg = (await execFileAsync('wslpath', ['-w', dir])).stdout.trim()
    return { dir, arg }
  } catch {
    // No cmd.exe bridge (plain Linux with a Windows binary on PATH): fall back
    // to the WSL temp; the browser may refuse it, which surfaces as a clear
    // "无法启动浏览器" error the page shows.
    const dir = await mkdtemp(path.join(os.tmpdir(), 'dumate-login-'))
    return { dir, arg: dir }
  }
}

/** Locate a browser that accepts `--remote-debugging-port` and a custom profile. */
export async function findBrowser() {
  for (const name of LINUX_BROWSERS) {
    const found = await new Promise(resolve => {
      execFile('which', [name], (error, stdout) => resolve(error === null ? stdout.trim() : ''))
    })
    if (found !== '') return { command: found, platform: 'linux' }
  }
  for (const winPath of WINDOWS_BROWSERS) {
    const wslPath = windowsPathToWsl(winPath)
    if (wslPath !== undefined && existsSync(wslPath)) return { command: wslPath, platform: 'windows' }
  }
  return undefined
}

/**
 * Read the port Chrome chose for its debugging server.
 *
 * Asking the browser for port 0 and reading `DevToolsActivePort` is the
 * canonical way: a port that looks free to us is not necessarily bindable by
 * the browser, which is exactly what happened under WSL's mirrored networking
 * (Windows and WSL share the loopback port space, so our probe held the port
 * long enough for Chrome's bind to fail).
 *
 * @param {string} profileDir - WSL-side path of the browser profile.
 * @returns {Promise<number>}
 */
async function waitForActivePort(profileDir, timeoutMs = 25_000) {
  const file = path.join(profileDir, 'DevToolsActivePort')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const text = await readFile(file, 'utf8')
      const port = Number(text.split('\n')[0].trim())
      if (Number.isInteger(port) && port > 0 && port < 65_536) return port
    } catch {
      // not written yet
    }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error('浏览器没有写出调试端口（启动失败或被已有窗口接管）')
}

/** One JSON-RPC call over an open DevTools WebSocket. */
function callCdp(socket, method, params = {}, timeoutMs = 10_000) {
  const id = callCdp.nextId = (callCdp.nextId ?? 0) + 1
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeEventListener('message', onMessage)
      reject(new Error(`CDP ${method} timed out`))
    }, timeoutMs)
    function onMessage(event) {
      let payload
      try {
        payload = JSON.parse(typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8'))
      } catch {
        return
      }
      if (payload.id !== id) return
      clearTimeout(timer)
      socket.removeEventListener('message', onMessage)
      if (payload.error !== undefined) reject(new Error(`CDP ${method}: ${payload.error.message ?? 'error'}`))
      else resolve(payload.result)
    }
    socket.addEventListener('message', onMessage)
    socket.send(JSON.stringify({ id, method, params }))
  })
}

/** Wait until the debugging endpoint answers, or throw. */
async function waitForEndpoint(port, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) return await response.json()
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise(resolve => setTimeout(resolve, 300))
  }
  throw new Error(`浏览器调试端口未就绪：${lastError?.message ?? 'timeout'}`)
}

/** Compose a DuMate cookie header from a CDP cookie list. */
export function cookieHeaderFrom(cookies) {
  const pairs = []
  for (const cookie of cookies ?? []) {
    if (cookie === null || typeof cookie !== 'object') continue
    const domain = String(cookie.domain ?? '').replace(/^\./, '')
    if (!COOKIE_DOMAIN.test(domain)) continue
    if (typeof cookie.name !== 'string' || cookie.name === '') continue
    pairs.push([cookie.name, String(cookie.value ?? '')])
  }
  // Stable order keeps the stored header diff-able; values are what matter.
  pairs.sort((a, b) => a[0].localeCompare(b[0]))
  return normalizeCookie(pairs.map(([name, value]) => `${name}=${value}`).join('; '))
}

/** Whether a captured jar is a complete, signed-in DuMate session. */
function sessionComplete(cookie) {
  return cookieValue(cookie, 'BDUSS') !== undefined && cookieValue(cookie, 'bce-user-info') !== undefined
}

/**
 * One interactive sign-in session.
 *
 * States: `launching` → `waiting` → (`capturing`) → `ok` | `error` | `cancelled`.
 * The service is a singleton per plugin instance: starting while a session is
 * live returns that session instead of opening a second browser.
 */
export class BrowserLogin {
  /**
   * @param {object} options
   * @param {import('./store.js').Store} options.store
   * @param {import('./auth.js').TokenPool} options.tokens
   * @param {{info?:Function, warn?:Function}} [options.logger]
   */
  constructor(options) {
    this.store = options.store
    this.tokens = options.tokens
    this.logger = options.logger ?? {}
    this.session = undefined
    this.timer = undefined
  }

  /** Public view of the current (or last) session. */
  status() {
    if (this.session === undefined) return { state: 'idle' }
    const { state, message, error, accountId, startedAt, browserLabel } = this.session
    return { state, message, error, accountId, startedAt, browserLabel, ageMs: Date.now() - startedAt }
  }

  /**
   * Open the sign-in browser and wait for the cookie jar to become complete.
   *
   * @returns {Promise<{ok:boolean, state:string, error?:string, account?:object}>}
   */
  async start() {
    if (this.session !== undefined && ['launching', 'waiting', 'capturing'].includes(this.session.state)) {
      return { ok: true, state: this.session.state, message: this.session.message }
    }
    const browser = await findBrowser()
    if (browser === undefined) {
      this.session = { state: 'error', error: '没有找到 Chrome / Edge / Brave：请安装一个，或改用「粘贴 Cookie」', startedAt: Date.now() }
      return { ok: false, state: 'error', error: this.session.error }
    }
    const session = {
      state: 'launching',
      message: '正在启动登录窗口…',
      startedAt: Date.now(),
      browserLabel: browser.platform === 'windows' ? 'Windows Chrome/Edge' : path.basename(browser.command),
      child: undefined,
      socket: undefined,
      profileDir: undefined,
      port: 0,
      cancelled: false,
    }
    this.session = session
    try {
      const profile = await profileDirFor(browser)
      session.profileDir = profile.dir
      const profileArg = profile.arg
      const args = [
        // Let the browser pick; see waitForActivePort for why a caller-chosen
        // port is unreliable across the WSL/Windows loopback boundary.
        '--remote-debugging-port=0',
        '--remote-debugging-address=127.0.0.1',
        `--user-data-dir=${profileArg}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-features=Translate,MediaRouter',
        LOGIN_URL,
      ]
      const { spawn } = await import('node:child_process')
      session.child = spawn(browser.command, args, { detached: true, stdio: 'ignore' })
      session.child.unref()
      session.child.on('error', error => {
        session.state = 'error'
        session.error = `无法启动浏览器：${error.message}`
      })
      session.port = await waitForActivePort(profile.dir)
      this.logger.info?.(`dumate-provider: login browser started on port ${session.port} (${session.browserLabel})`)

      const version = await waitForEndpoint(session.port)
      session.state = 'waiting'
      session.message = '已打开登录窗口：请在浏览器里完成百度账号登录'
      this.timer = setInterval(() => {
        void this.#poll().catch(error => {
          this.logger.warn?.(`dumate-provider: login poll failed: ${error?.message ?? error}`)
        })
      }, POLL_MS)
      void this.#watchdog()
      void version
      return { ok: true, state: session.state, message: session.message, browserLabel: session.browserLabel }
    } catch (error) {
      session.state = 'error'
      session.error = error?.message ?? String(error)
      await this.#cleanup()
      return { ok: false, state: 'error', error: session.error }
    }
  }

  /** Stop the current session without importing anything. */
  async cancel() {
    if (this.session === undefined) return { ok: true, state: 'idle' }
    this.session.cancelled = true
    this.session.state = 'cancelled'
    this.session.message = '已取消登录'
    await this.#cleanup()
    return { ok: true, state: 'cancelled' }
  }

  /** Fail a session that outlived the user's patience. */
  async #watchdog() {
    const session = this.session
    if (session === undefined) return
    await new Promise(resolve => setTimeout(resolve, SESSION_TIMEOUT_MS))
    if (this.session !== session) return
    if (!['launching', 'waiting', 'capturing'].includes(session.state)) return
    session.state = 'error'
    session.error = '登录超时（5 分钟）：请重新点击「浏览器登录」，或改用「粘贴 Cookie」'
    await this.#cleanup()
  }

  /** Read the jar once per tick and import it as soon as it is complete. */
  async #poll() {
    const session = this.session
    if (session === undefined || session.state !== 'waiting') return
    if (session.socket === undefined) {
      const version = await waitForEndpoint(session.port, 5000)
      const socket = new WebSocket(version.webSocketDebuggerUrl)
      await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true })
        socket.addEventListener('error', () => reject(new Error('无法连接浏览器调试端口')), { once: true })
      })
      session.socket = socket
    }
    const { cookies } = await callCdp(session.socket, 'Storage.getCookies')
    const cookie = cookieHeaderFrom(cookies)
    if (!sessionComplete(cookie)) return

    session.state = 'capturing'
    session.message = '已读到登录 Cookie，正在验证…'
    const invalid = validateCookie(cookie)
    if (invalid !== undefined) {
      session.state = 'waiting'
      session.message = `Cookie 不完整（${invalid}），请确认已经登录搭子`
      return
    }
    const probe = await this.tokens.token(`login-${Date.now()}`, cookie, { force: true })
    if (!probe.ok) {
      session.state = 'waiting'
      session.message = `登录态还不能换 token（${probe.error ?? '未知原因'}），请稍候`
      return
    }
    const id = this.store.nextAccountId()
    const existing = this.store.accounts().length
    // Default the label to the Baidu nickname behind the freshly captured
    // cookie; `搭子账号 N` is the fallback when the identity call fails.
    const who = await userInfo({ cookie }).catch(() => ({ ok: false, name: '' }))
    const name = who.ok === true && who.name !== '' ? who.name.slice(0, 40) : `搭子账号 ${existing + 1}`
    const account = {
      id,
      name,
      cookie,
      enabled: true,
      priority: existing,
      createdAt: Date.now(),
      lastError: '',
      lastOkAt: 0,
      tokenExpiresAt: probe.expiresAt ?? 0,
      checkin: { date: '', ok: false, points: 0, at: 0 },
      balance: { remaining: 0, used: 0, granted: 0, at: 0, isSubscribed: false, packages: [], external: [], nextExpiryAt: 0 },
    }
    await this.store.update(state => {
      state.accounts.push(account)
    })
    session.state = 'ok'
    session.message = '登录成功，账号已添加'
    session.accountId = id
    this.logger.info?.(`dumate-provider: browser login added account ${id}`)
    await this.#cleanup()
  }

  /** Close the browser, drop the socket and delete the throwaway profile. */
  async #cleanup() {
    if (this.timer !== undefined) {
      clearInterval(this.timer)
      this.timer = undefined
    }
    const session = this.session
    if (session === undefined) return
    try {
      if (session.socket !== undefined) {
        await callCdp(session.socket, 'Browser.close', {}, 3000).catch(() => {})
        session.socket.close()
      }
    } catch {
      // Closing a browser that already exited is not an error.
    }
    session.socket = undefined
    try {
      session.child?.kill()
    } catch {
      // already gone
    }
    if (session.profileDir !== undefined) {
      // Chrome needs a moment to release its files on Windows.
      await new Promise(resolve => setTimeout(resolve, 400))
      await rm(session.profileDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}
