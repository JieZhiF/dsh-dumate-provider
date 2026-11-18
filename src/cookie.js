/**
 * Cookie intake for the settings page.
 *
 * The only credential a DuMate personal account has is its web session cookie,
 * and every meaningful cookie on it is httpOnly — `document.cookie` cannot read
 * them. So the accepted inputs are the shapes a user can actually copy out of
 * DevTools: a `Cookie` request header, the cookie table as JSON, or a plain
 * map. Normalizing here is what keeps the HTTP layer unaware of where the
 * string came from.
 *
 * @module src/cookie
 */

/** Cookie whose value doubles as the CSRF token for the points endpoints. */
const CSRF_COOKIE = 'bce-user-info'

/** The one cookie that proves the session is a logged-in Baidu account. */
const AUTH_COOKIE = 'BDUSS'

/**
 * Turn any accepted copy-paste shape into a canonical `name=value; ...` header.
 *
 * @param {string} raw - user input from the settings page or a stored record.
 * @returns {string} canonical cookie header, possibly empty.
 */
export function normalizeCookie(raw) {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (text === '') return ''

  // 1. A curl command: keep whatever follows `Cookie:`.
  //
  //    The value is usually wrapped by the shell around the whole header
  //    (`-H 'Cookie: a=1; b=2'`), so the quote sits BEFORE `Cookie`, not after
  //    the colon. Read to the end of the line, then cut at the first quote so a
  //    following `-H 'x: y'` cannot leak into the cookie.
  const curl = /cookie:\s*([^\n\r]*)/i.exec(text)
  if (curl !== null) {
    let value = curl[1].trim()
    const quote = value.search(/['"]/)
    if (quote !== -1) value = value.slice(0, quote)
    return canonicalize(value.replace(/['"]+$/, ''))
  }

  // 2. JSON: DevTools' "Copy all as JSON" (array of {name,value}) or a plain map.
  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text)
      const pairs = []
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (entry === null || typeof entry !== 'object') continue
          const name = entry.name ?? entry.key
          if (typeof name !== 'string' || name === '') continue
          pairs.push([name, String(entry.value ?? '')])
        }
      } else if (parsed !== null && typeof parsed === 'object') {
        for (const [name, value] of Object.entries(parsed)) {
          if (typeof name !== 'string' || name === '') continue
          if (value !== null && typeof value === 'object') continue
          pairs.push([name, String(value ?? '')])
        }
      }
      return canonicalize(pairs.map(([name, value]) => `${name}=${value}`).join('; '))
    } catch {
      // Fall through to the header parser: a malformed JSON paste is usually a
      // header with a quote in a value.
    }
  }

  return canonicalize(text)
}

/** Join name=value fragments, dropping empties and the `Cookie:` label. */
function canonicalize(raw) {
  const fragments = String(raw ?? '')
    .replace(/^cookie:\s*/i, '')
    .split(/[;\n\r]+/)
    .map(part => part.trim())
    .filter(part => part !== '' && part.includes('='))
  return fragments.join('; ')
}

/**
 * Read one cookie's value out of a canonical header.
 *
 * Values may legitimately contain `=`, so only the first separator splits.
 *
 * @param {string} cookie - canonical header.
 * @param {string} name - cookie name.
 * @returns {string|undefined}
 */
export function cookieValue(cookie, name) {
  for (const part of String(cookie ?? '').split(';')) {
    const at = part.indexOf('=')
    if (at <= 0) continue
    if (part.slice(0, at).trim() !== name) continue
    return part.slice(at + 1).trim()
  }
  return undefined
}

/**
 * The CSRF token the points and check-in endpoints require.
 *
 * Measured 2026-11-17: `www.dumate.cn` accepts these calls without it, but
 * every implementation that omits it has, at some point, received the
 * misleading `登录凭证已过期` refusal. Sending it costs nothing.
 *
 * @param {string} cookie - canonical header.
 * @returns {string} token, or an empty string when the cookie lacks it.
 */
export function csrfFrom(cookie) {
  const value = cookieValue(cookie, CSRF_COOKIE)
  return typeof value === 'string' ? value.replace(/^["']+|["']+$/g, '') : ''
}

/**
 * Decide whether a pasted cookie could be a logged-in DuMate session.
 *
 * @param {string} cookie - canonical header.
 * @returns {string|undefined} a user-facing reason when it cannot, else undefined.
 */
export function validateCookie(cookie) {
  if (cookie === '') return 'Cookie 是空的 / the cookie is empty'
  if (cookieValue(cookie, AUTH_COOKIE) === undefined) {
    return `Cookie 里没有 ${AUTH_COOKIE}，这不是一个已登录的百度账号 / no ${AUTH_COOKIE} cookie: this is not a signed-in Baidu session`
  }
  return undefined
}

/** Names present in a canonical header, for diagnostics (never values). */
export function cookieNames(cookie) {
  const names = []
  for (const part of String(cookie ?? '').split(';')) {
    const at = part.indexOf('=')
    if (at > 0) names.push(part.slice(0, at).trim())
  }
  return names
}
