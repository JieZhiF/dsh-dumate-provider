/**
 * Pure-logic tests for the host half. No network, no DSH: everything here is
 * the projection code that a wrong edit would corrupt silently.
 *
 * Run with `npm test`.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  IMAGE_BUDGET,
  IMAGE_PLACEHOLDER,
  REQUEST_IMAGE_MAX_BYTES,
  buildBody,
  finishReasonOf,
  mapUsage,
  prepareRequestImages,
  readSse,
  toWireMessages,
} from '../src/wire.js'
import { csrfFrom, normalizeCookie, validateCookie } from '../src/cookie.js'
import { MODELS, modelInfo } from '../src/constants.js'

test('normalizeCookie accepts a Cookie header', () => {
  assert.equal(normalizeCookie('BDUSS=abc; STOKEN=def'), 'BDUSS=abc; STOKEN=def')
  assert.equal(normalizeCookie('Cookie: BDUSS=abc; STOKEN=def'), 'BDUSS=abc; STOKEN=def')
  assert.equal(normalizeCookie('  BDUSS=abc ;;\n STOKEN=def  '), 'BDUSS=abc; STOKEN=def')
})

test('normalizeCookie accepts DevTools JSON (array and map)', () => {
  const asArray = JSON.stringify([{ name: 'BDUSS', value: 'abc' }, { name: 'bce-user-info', value: '"quoted"' }])
  assert.equal(normalizeCookie(asArray), 'BDUSS=abc; bce-user-info="quoted"')
  const asMap = JSON.stringify({ BDUSS: 'abc', PSTM: '1' })
  assert.equal(normalizeCookie(asMap), 'BDUSS=abc; PSTM=1')
})

test('normalizeCookie accepts a curl command', () => {
  const curl = "curl 'https://www.dumate.cn/api' -H 'Cookie: BDUSS=abc; STOKEN=d' -H 'x: y'"
  assert.equal(normalizeCookie(curl), 'BDUSS=abc; STOKEN=d')
})

test('validateCookie requires BDUSS', () => {
  assert.equal(validateCookie('BDUSS=abc'), undefined)
  assert.match(validateCookie('STOKEN=abc'), /BDUSS/)
  assert.match(validateCookie(''), /empty/)
})

test('csrfFrom strips quotes', () => {
  assert.equal(csrfFrom('BDUSS=x; bce-user-info="2026-01-01"'), '2026-01-01')
  assert.equal(csrfFrom('BDUSS=x'), '')
})

test('toWireMessages maps every role the loop sends', () => {
  const wire = toWireMessages([
    { role: 'system', content: [{ type: 'text', text: 'be nice' }] },
    { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    {
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'thinking' },
        { type: 'text', text: 'calling' },
        { type: 'tool-call', id: 'call_1', name: 'get_weather', arguments: '{"city":"北京"}' },
      ],
    },
    { role: 'tool', toolCallId: 'call_1', content: [{ type: 'text', text: '{"temp":12}' }] },
  ])
  assert.deepEqual(wire, [
    { role: 'system', content: 'be nice' },
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'calling', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"北京"}' } }] },
    { role: 'tool', tool_call_id: 'call_1', content: '{"temp":12}' },
  ])
})

test('toWireMessages prepends a one-shot system prompt and drops empty turns', () => {
  const wire = toWireMessages([{ role: 'user', content: [] }], { system: 'prompt' })
  assert.deepEqual(wire, [{ role: 'system', content: 'prompt' }])
})

test('buildBody carries tools, stream and a bounded max_tokens', () => {
  const body = buildBody({
    model: 'deepseek-v41-flash',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    tools: [{ name: 'get_weather', description: 'd', parameters: { type: 'object', properties: {} } }],
    temperature: 0.2,
    stop: ['\n\n'],
  }, modelInfo('deepseek-v41-flash'))
  assert.equal(body.model, 'deepseek-v41-flash')
  assert.equal(body.stream, true)
  assert.deepEqual(body.stream_options, { include_usage: true })
  assert.equal(body.max_tokens, 32768)
  assert.equal(body.temperature, 0.2)
  assert.deepEqual(body.stop, ['\n\n'])
  assert.equal(body.tool_choice, 'auto')
  assert.equal(body.tools[0].type, 'function')
  assert.equal(body.tools[0].function.name, 'get_weather')
})

test('mapUsage subtracts cache hits and never yields NaN', () => {
  assert.deepEqual(mapUsage({ prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 40 } }), {
    inputTokens: 60, outputTokens: 10, totalTokens: 110, cacheReadTokens: 40,
  })
  const bare = mapUsage({ prompt_tokens: 5, completion_tokens: 1 })
  assert.equal(bare.inputTokens, 5)
  assert.equal(bare.cacheReadTokens, undefined)
  assert.equal(mapUsage(undefined), undefined)
})

test('finishReasonOf maps provider reasons', () => {
  assert.deepEqual(finishReasonOf('stop'), { kind: 'stop' })
  assert.deepEqual(finishReasonOf('length'), { kind: 'max-tokens' })
  assert.deepEqual(finishReasonOf('tool_calls'), { kind: 'tool-calls' })
  assert.deepEqual(finishReasonOf(undefined), { kind: 'stop' })
})

test('readSse decodes a multi-byte character split across chunks', async () => {
  const text = 'data: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: [DONE]\n\n'
  const bytes = Buffer.from(text, 'utf8')
  // Split in the middle of the first Chinese character's 3-byte sequence.
  const cut = bytes.indexOf(Buffer.from('你', 'utf8')) + 1
  const chunks = [bytes.subarray(0, cut), bytes.subarray(cut)]
  async function* source() {
    for (const chunk of chunks) yield chunk
  }
  const frames = []
  for await (const event of readSse(source())) frames.push(event)
  assert.equal(frames.length, 2)
  assert.match(frames[0].data, /你好/u)
  assert.deepEqual(frames[1], { done: true })
})

test('the catalog keeps 22 unique ids with usable limits', () => {
  assert.equal(MODELS.length, 22)
  assert.equal(new Set(MODELS.map(entry => entry.id)).size, 22)
  for (const entry of MODELS) {
    assert.ok(entry.context > 0, entry.id)
    assert.ok(entry.maxOutput > 0, entry.id)
  }
  assert.equal(modelInfo('dm-auto-model/text.L1').context, 1_048_576)
})

test('routeKey folds separators so hyphenated paths reach their handler', async () => {
  const { routeKey } = await import('../src/routes.js')
  assert.equal(routeKey('POST', 'api-account/add'), 'POST_api_account_add')
  assert.equal(routeKey('POST', 'account/checkin'), 'POST_account_checkin')
  assert.equal(routeKey('GET', ''), 'GET_state')
  assert.equal(routeKey('POST', 'login/status'), 'POST_login_status')
})

// ── check-in state machine ──────────────────────────────────────────────────
function fakeStore(account) {
  return { state: { accounts: [account], runs: [] }, update(fn) { fn(this.state) } }
}

test('check-in never re-claims when live status says today is done', async () => {
  const { CheckinService } = await import('../src/checkin.js')
  let claims = 0
  const account = { id: 'a1', name: 't', cookie: 'x', checkin: { date: '', done: false } }
  const service = new CheckinService({
    store: fakeStore(account),
    api: {
      checkinStatus: async () => ({ ok: true, todayDone: true, streak: 3, totalPoints: 900, issuedToast: '今日已领取 200 积分，前往 PC 端可再领取 300 积分' }),
      claimCheckin: async () => { claims += 1; return { ok: true, result: {} } },
    },
  })
  const result = await service.run(account, { force: true })
  assert.equal(claims, 0, 'the idempotent claim endpoint must not be hit again')
  assert.equal(result.ok, true)
  assert.equal(result.already, true)
  assert.equal(result.points, 0)
  assert.match(result.message, /已领取|already/)
})

test('check-in claims once when today is open and reports the delta', async () => {
  const { CheckinService } = await import('../src/checkin.js')
  let claims = 0
  let total = 700
  const account = { id: 'a1', name: 't', cookie: 'x', checkin: {} }
  const service = new CheckinService({
    store: fakeStore(account),
    api: {
      checkinStatus: async () => ({ ok: true, todayDone: claims > 0, streak: claims, totalPoints: total, issuedToast: '' }),
      claimCheckin: async () => { claims += 1; total += 200; return { ok: true, result: {} } },
    },
  })
  const result = await service.run(account)
  assert.equal(claims, 1)
  assert.equal(result.already, false)
  assert.equal(result.granted, true)
  assert.equal(result.points, 200)
  assert.match(result.message, /\+200/)
})

test('a claim that grants nothing says so instead of celebrating', async () => {
  const { CheckinService } = await import('../src/checkin.js')
  const account = { id: 'a1', name: 't', cookie: 'x', checkin: {} }
  const service = new CheckinService({
    store: fakeStore(account),
    api: {
      checkinStatus: async () => ({ ok: true, todayDone: false, streak: 0, totalPoints: 500, issuedToast: '' }),
      claimCheckin: async () => ({ ok: true, result: {} }),
    },
  })
  const result = await service.run(account)
  assert.equal(result.ok, true)
  assert.equal(result.granted, false)
  assert.equal(result.points, 0)
  assert.match(result.message, /未检测到|no points/)
})

test('check-in reports expiry without calling the claim endpoint', async () => {
  const { CheckinService } = await import('../src/checkin.js')
  let claims = 0
  const account = { id: 'a1', name: 't', cookie: 'x', checkin: {} }
  const service = new CheckinService({
    store: fakeStore(account),
    api: {
      checkinStatus: async () => ({ ok: false, error: '登录凭证已过期', expired: true }),
      claimCheckin: async () => { claims += 1; return { ok: true } },
    },
  })
  const result = await service.run(account)
  assert.equal(result.ok, false)
  assert.equal(result.expired, true)
  assert.equal(claims, 0)
})

test('a lagging grant counter is caught by the day flip, not read as failure', async () => {
  const { CheckinService } = await import('../src/checkin.js')
  let claims = 0
  const account = { id: 'a1', name: 't', cookie: 'x', checkin: {} }
  const service = new CheckinService({
    store: fakeStore(account),
    api: {
      // totalPoints never moves (stale counter), but the day list flips to done
      // once the claim lands, and the upstream toast names the grant.
      checkinStatus: async () => ({
        ok: true, todayDone: claims > 0, streak: 1, totalPoints: 500,
        issuedToast: claims > 0 ? '今日已领取 200 积分' : '',
      }),
      claimCheckin: async () => { claims += 1; return { ok: true, result: {} } },
    },
  })
  const result = await service.run(account)
  assert.equal(result.granted, true, 'the day flip proves the claim registered')
  assert.equal(result.points, 200, 'the toast names the granted amount')
  assert.match(result.message, /\+200/)
})

test('a claim that registers but names no amount reports points pending', async () => {
  const { CheckinService } = await import('../src/checkin.js')
  let claims = 0
  const account = { id: 'a1', name: 't', cookie: 'x', checkin: {} }
  const service = new CheckinService({
    store: fakeStore(account),
    api: {
      checkinStatus: async () => ({ ok: true, todayDone: claims > 0, streak: 1, totalPoints: 500, issuedToast: '' }),
      claimCheckin: async () => { claims += 1; return { ok: true, result: {} } },
    },
  })
  const result = await service.run(account)
  assert.equal(result.granted, true)
  assert.equal(result.points, 0)
  assert.match(result.message, /稍后到账|pending/)
})

// ── reasoning effort ────────────────────────────────────────────────────────
test('only the five low-latency-backend models advertise a reasoning ladder', async () => {
  const { supportsReasoning, REASONING_EFFORTS } = await import('../src/constants.js')
  for (const id of ['deepseek-v41-flash', 'model-text', 'dm-auto-model/text.L0', 'dm-auto-model/mm.L0', 'dm-auto-model/mm.L2']) {
    assert.equal(supportsReasoning(id), true, id)
  }
  // The other auto tiers and every third-party model run a different backend.
  for (const id of ['dm-auto-model/mm.L1', 'dm-auto-model/text.L1', 'dm-auto-model/text.L2', 'kimi-k3', 'glm-53', 'qwen3.8-max']) {
    assert.equal(supportsReasoning(id), false, id)
  }
  assert.deepEqual(REASONING_EFFORTS.map(e => e.id), ['off', 'low', 'high', 'max'])
})

test('effort maps to the gateway vocabulary, off as an explicit disable', async () => {
  const { buildBody } = await import('../src/wire.js')
  const entry = { id: 'deepseek-v41-flash', vision: true }
  const none = buildBody({ model: entry.id, messages: [{ role: 'user', content: 'hi' }], reasoningEffort: 'off' }, entry)
  assert.equal(none.reasoning_effort, undefined, 'off must not send an effort string')
  assert.deepEqual(none.thinking, { type: 'disabled' })
  assert.equal(none.enable_thinking, false, 'omitting the switch still thinks upstream')

  const max = buildBody({ model: entry.id, messages: [{ role: 'user', content: 'hi' }], reasoningEffort: 'max' }, entry)
  assert.equal(max.reasoning_effort, 'max')
  assert.deepEqual(max.thinking, { type: 'enabled' })
  assert.equal(max.enable_thinking, true)

  const low = buildBody({ model: entry.id, messages: [{ role: 'user', content: 'hi' }], reasoningEffort: 'low' }, entry)
  assert.equal(low.reasoning_effort, 'high', 'the Baidu channel runs low at high strength')
})

test('an unsupported model never receives effort fields', async () => {
  const { buildBody } = await import('../src/wire.js')
  const entry = { id: 'kimi-k3', vision: true }
  const body = buildBody({ model: entry.id, messages: [{ role: 'user', content: 'hi' }], reasoningEffort: 'max' }, entry)
  assert.equal(body.reasoning_effort, undefined)
  assert.equal(body.thinking, undefined)
  assert.equal(body.enable_thinking, undefined)
})

test('omitting the effort sends no thinking fields at all', async () => {
  const { buildBody } = await import('../src/wire.js')
  const entry = { id: 'model-text', vision: true }
  const body = buildBody({ model: entry.id, messages: [{ role: 'user', content: 'hi' }] }, entry)
  assert.equal(body.reasoning_effort, undefined)
  assert.equal(body.thinking, undefined)
})

test('a successful check-in writes a run record and keeps the server day list', async () => {
  const { CheckinService } = await import('../src/checkin.js')
  let claims = 0
  const account = { id: 'a1', name: '主号', cookie: 'x', checkin: {} }
  const store = fakeStore(account)
  const service = new CheckinService({
    store,
    api: {
      checkinStatus: async () => ({
        ok: true, todayDone: claims > 0, streak: 4, totalPoints: claims > 0 ? 900 : 700,
        signInDays: ['2026-11-16', '2026-11-17', ...(claims > 0 ? ['2026-11-18'] : [])],
        issuedToast: '',
      }),
      claimCheckin: async () => { claims += 1; return { ok: true, result: {} } },
    },
  })
  const result = await service.run(account)
  assert.equal(result.granted, true)
  assert.equal(store.state.runs.length, 1, 'a real grant must appear in the record')
  assert.match(store.state.runs[0].message, /\+200/)
  assert.equal(store.state.runs[0].name, '主号')
  assert.deepEqual(account.checkin.days, ['2026-11-16', '2026-11-17', '2026-11-18'])
  // An "already claimed" repeat adds no noise to the record.
  const again = await service.run(account, { force: true })
  assert.equal(again.already, true)
  assert.equal(store.state.runs.length, 1, 'a no-op repeat must not be logged')
})

// ── cooldown pool ────────────────────────────────────────────────────────────
test('cooldownSeconds 0 disables parking but keeps the reason', async () => {
  const { AccountPool } = await import('../src/pool.js')
  const store = { settings: () => ({ cooldownSeconds: 0 }) }
  const pool = new AccountPool({ store })
  pool.markFailure('a1', { message: 'HTTP 503' })
  assert.equal(pool.cooldownUntil('a1'), 0, 'an account is never parked when cooldown is off')
  assert.equal(pool.available({ id: 'a1', enabled: true, cookie: 'x' }), true)
  assert.equal(pool.view().a1.reason, 'HTTP 503', 'the reason still surfaces for the page')
})

test('cooldown doubles from the configured base and clear drops it', async () => {
  const { AccountPool } = await import('../src/pool.js')
  const store = { settings: () => ({ cooldownSeconds: 30 }) }
  const pool = new AccountPool({ store })
  pool.markFailure('a1', { message: 'boom' })
  const first = pool.cooldownUntil('a1') - Date.now()
  assert.ok(first >= 29_000 && first <= 30_000, `first backoff ≈30s, got ${first}`)
  pool.markFailure('a1', { message: 'boom' })
  const second = pool.cooldownUntil('a1') - Date.now()
  assert.ok(second >= 59_000, `second backoff doubles ≈60s, got ${second}`)
  assert.equal(pool.clear('a1'), true)
  assert.equal(pool.cooldownUntil('a1'), 0)
})

test('absent cooldownSeconds falls back to the 60s default', async () => {
  const { AccountPool } = await import('../src/pool.js')
  const pool = new AccountPool({ store: { settings: () => ({}) } })
  assert.equal(pool.baseMs(), 60_000)
})

test('isPlaceholderName matches every auto label and nothing custom', async () => {
  const { isPlaceholderName } = await import('../src/store.js')
  for (const n of ['搭子账号 1', '搭子账号 12', '账号 3', '账号 a1', '账号 07']) {
    assert.equal(isPlaceholderName(n), true, n)
  }
  for (const n of ['沁染节制', '搭子主号', '公司号 2 组', '账号 1 的备份', '']) {
    assert.equal(isPlaceholderName(n), false, n)
  }
})

// ── per-session usage attribution ─────────────────────────────────────────────
function usageStore() {
  const state = { sessionUsage: {}, sessionUsageOrder: [], seenChargeSigs: [], accountUsage: {} }
  return { state, get: () => state, update(fn) { fn(state); return Promise.resolve() } }
}
const sec = s => ({ ok: true, rows: s.map((r, i) => ({ at: r.at, points: r.p, packageId: 'pkg', sig: `${r.at}|-${r.p}|pkg|${i}` })), consumedPoints: 0, totalCount: s.length })

test('a turn folds only the charges inside its own window', async () => {
  const { UsageTracker } = await import('../src/usage.js')
  const store = usageStore()
  let rows = []
  const tracker = new UsageTracker({ store, api: { usageRecords: async () => sec(rows) } })
  const account = { cookie: 'x' }
  rows = [{ at: Math.floor(Date.now() / 1000), p: 6.62 }]
  tracker.turnStart('s1')
  const r = await tracker.turnEnd(account, 's1')
  assert.equal(r.ok, true)
  assert.equal(r.points, 6.62)
  assert.equal(tracker.total('s1'), 6.62)
})

test('the same charge is never counted twice across turns', async () => {
  const { UsageTracker } = await import('../src/usage.js')
  const store = usageStore()
  const at = Math.floor(Date.now() / 1000)
  const tracker = new UsageTracker({ store, api: { usageRecords: async () => sec([{ at, p: 3 }]) } })
  const account = { cookie: 'x' }
  tracker.turnStart('s1'); await tracker.turnEnd(account, 's1')
  tracker.turnStart('s1'); await tracker.turnEnd(account, 's1')
  assert.equal(tracker.total('s1'), 3, 'overlapping windows must not double-count')
})

test('a turn also charges the account that served it', async () => {
  const { UsageTracker } = await import('../src/usage.js')
  const store = usageStore()
  const rows = [{ at: Math.floor(Date.now() / 1000), p: 4.5 }]
  const tracker = new UsageTracker({ store, api: { usageRecords: async () => sec(rows) } })
  tracker.turnStart('s1')
  await tracker.turnEnd({ id: 'a1', cookie: 'x' }, 's1')
  assert.equal(store.state.accountUsage.a1.points, 4.5)
  assert.equal(store.state.accountUsage.a1.turns, 1)
  assert.equal(store.state.sessionUsage.s1.accountId, 'a1')

  // Per-account and per-session totals come from one attribution.
  assert.equal(tracker.view()[0].accountId, 'a1')
  const byAccount = tracker.accountView(id => (id === 'a1' ? '搭子甲' : id))
  assert.deepEqual(byAccount.map(row => [row.name, row.points]), [['搭子甲', 4.5]])
})

test('two accounts each keep their own spend', async () => {
  const { UsageTracker } = await import('../src/usage.js')
  const store = usageStore()
  const at = Math.floor(Date.now() / 1000)
  // Two distinct charges, one per account: a single charge shared between two
  // accounts would (correctly) be counted once, since the fingerprint is global.
  let rows = [{ at: at - 1, p: 2 }]
  const tracker = new UsageTracker({ store, api: { usageRecords: async () => sec(rows) } })
  tracker.turnStart('s1')
  await tracker.turnEnd({ id: 'a1', cookie: 'x' }, 's1')
  rows = [{ at, p: 2 }]
  tracker.turnStart('s2')
  await tracker.turnEnd({ id: 'a2', cookie: 'y' }, 's2')
  const view = tracker.accountView()
  assert.equal(view.length, 2)
  assert.equal(view.every(row => row.points === 2), true)
  assert.equal(store.state.accountUsage.a1.points, 2)
  assert.equal(store.state.accountUsage.a2.points, 2)
})

test('rescan claims a late charge for the most recent session once', async () => {
  const { UsageTracker } = await import('../src/usage.js')
  const store = usageStore()
  const at = Math.floor(Date.now() / 1000)
  let rows = []
  const tracker = new UsageTracker({ store, api: { usageRecords: async () => sec(rows) } })
  const account = { cookie: 'x' }
  // A turn whose read found nothing yet (the charge had not landed).
  tracker.turnStart('s1')
  await tracker.turnEnd(account, 's1')
  assert.equal(tracker.total('s1'), 0)
  // The charge lands late; rescan folds it once into the recent session.
  rows = [{ at, p: 5 }]
  const r = await tracker.rescan(account)
  assert.equal(r.points, 5)
  assert.equal(tracker.total('s1'), 5)
  const again = await tracker.rescan(account)
  assert.equal(again.points, 0, 'rescan must not re-add a counted charge')
})

test('view lists only sessions with charges, newest first', async () => {
  const { UsageTracker } = await import('../src/usage.js')
  const store = usageStore()
  let p = 0
  const tracker = new UsageTracker({ store, api: { usageRecords: async () => sec([{ at: Math.floor(Date.now() / 1000), p: (p += 1) }]) } })
  tracker.turnStart('sA'); await tracker.turnEnd({ cookie: 'x' }, 'sA')
  tracker.turnStart('sB'); await tracker.turnEnd({ cookie: 'x' }, 'sB')
  const view = tracker.view()
  assert.deepEqual(view.map(e => e.sessionId), ['sB', 'sA'])
  assert.equal(view[0].points, 2)
})

// ── vision image projection ──────────────────────────────────────────────────
test('toWireMessages projects vision images as image_url data URLs with a text handle', () => {
  const ref = { attachmentId: 'sha256:9fb7d720', mediaType: 'image/png', bytes: 4, width: 64, height: 64, name: 'dot.png' }
  const version = { data: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]), mediaType: 'image/png', bytes: 4, width: 64, height: 64 }
  const images = { versions: new Map([[ref.attachmentId, version]]), skipped: new Set() }

  const wire = toWireMessages([
    {
      role: 'user',
      content: [
        { type: 'text', text: '看图说话' },
        { type: 'image', attachment: ref },
      ],
    },
  ], { vision: true, images })

  assert.equal(wire.length, 1)
  assert.equal(wire[0].role, 'user')
  assert.equal(Array.isArray(wire[0].content), true, 'mixed text + image must use an array content')
  assert.equal(wire[0].content.length, 3)
  assert.deepEqual(wire[0].content[0], { type: 'text', text: '看图说话' })
  assert.equal(wire[0].content[1].type, 'text')
  assert.match(wire[0].content[1].text, /"dot\.png" \(sha256:9fb7d720\)/)
  assert.match(wire[0].content[1].text, /64x64px/)
  assert.deepEqual(wire[0].content[2], {
    type: 'image_url',
    image_url: { url: `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')}` },
  })
})

test('toWireMessages keeps a string content when a vision image was skipped or missing', () => {
  const ref = { attachmentId: 'sha256:deadbeef', mediaType: 'image/png', bytes: 100, width: 10, height: 10, name: 'big.png' }
  const images = { versions: new Map(), skipped: new Set([ref.attachmentId]) }

  const wire = toWireMessages([
    {
      role: 'user',
      content: [
        { type: 'text', text: '这张图呢？' },
        { type: 'image', attachment: ref },
      ],
    },
  ], { vision: true, images })

  assert.equal(wire.length, 1)
  assert.equal(typeof wire[0].content, 'string', 'text-only fallback must stay a string')
  assert.match(wire[0].content, /这张图呢？/)
  assert.match(wire[0].content, /sha256:deadbeef/)
  assert.doesNotMatch(wire[0].content, /data:image/)
})

test('toWireMessages emits text-only placeholder and never image_url when vision is false', () => {
  const ref = { attachmentId: 'sha256:9fb7d720', mediaType: 'image/png', bytes: 4, width: 64, height: 64 }
  const version = { data: Uint8Array.from([1, 2, 3, 4]), mediaType: 'image/png', bytes: 4, width: 64, height: 64 }
  const images = { versions: new Map([[ref.attachmentId, version]]), skipped: new Set() }

  const wire = toWireMessages([
    { role: 'user', content: [{ type: 'text', text: 'hi ' }, { type: 'image', attachment: ref }] },
  ], { vision: false, images })

  assert.equal(wire.length, 1)
  assert.equal(wire[0].content, `hi ${IMAGE_PLACEHOLDER}`)
})

test('toWireMessages keeps pure text messages as strings', () => {
  const wire = toWireMessages([
    { role: 'user', content: [{ type: 'text', text: '第一段' }, { type: 'text', text: '第二段' }] },
  ], { vision: true })
  assert.deepEqual(wire, [{ role: 'user', content: '第一段第二段' }])
})

test('prepareRequestImages deduplicates by attachmentId and enforces count and byte budgets', async () => {
  const ref1 = { attachmentId: 'sha256:1111', mediaType: 'image/png', bytes: 400, width: 100, height: 80 }
  const ref2 = { attachmentId: 'sha256:2222', mediaType: 'image/jpeg', bytes: 500, width: 200, height: 150 }
  const ref3 = { attachmentId: 'sha256:3333', mediaType: 'image/png', bytes: 300, width: 50, height: 50 }
  const calls = []
  const attachments = {
    async readImageRequest(ref, target) {
      calls.push({ id: ref.attachmentId, target })
      return {
        data: new Uint8Array(ref.bytes),
        mediaType: ref.mediaType,
        bytes: ref.bytes,
        width: ref.width,
        height: ref.height,
      }
    },
  }
  const messages = [
    { role: 'user', content: [{ type: 'image', attachment: ref1 }, { type: 'image', attachment: ref2 }] },
    { role: 'user', content: [{ type: 'image', attachment: ref1 }, { type: 'image', attachment: ref3 }] },
  ]
  // maxImages = 2 drops ref3 before reading; maxTotalBytes = 700 drops ref2 after reading (400 + 500 > 700).
  const { versions, skipped } = await prepareRequestImages(messages, attachments, {
    maxImages: 2,
    maxBytes: 1000,
    maxTotalBytes: 700,
  })
  assert.deepEqual(calls.map(c => c.id), ['sha256:1111', 'sha256:2222'], 'ref1 read once; ref3 skipped by maxImages')
  assert.equal(versions.has('sha256:1111'), true)
  assert.equal(versions.has('sha256:2222'), false)
  assert.equal(skipped.has('sha256:2222'), true)
  assert.equal(skipped.has('sha256:3333'), true)
})

test('prepareRequestImages swallows per-image attachment errors and keeps other images', async () => {
  const bad = { attachmentId: 'sha256:missing', mediaType: 'image/png', bytes: 100, width: 10, height: 10 }
  const good = { attachmentId: 'sha256:ok', mediaType: 'image/png', bytes: 8, width: 10, height: 10 }
  const warnings = []
  const attachments = {
    async readImageRequest(ref) {
      if (ref.attachmentId === 'sha256:missing') throw new Error('ENOENT: object missing')
      return { data: new Uint8Array(8), mediaType: 'image/png', bytes: 8, width: 10, height: 10 }
    },
  }
  const messages = [
    { role: 'user', content: [{ type: 'image', attachment: bad }, { type: 'image', attachment: good }] },
  ]
  const { versions, skipped } = await prepareRequestImages(messages, attachments, IMAGE_BUDGET, undefined, {
    warn: msg => warnings.push(msg),
  })
  assert.equal(versions.has('sha256:ok'), true)
  assert.equal(versions.has('sha256:missing'), false)
  assert.equal(skipped.has('sha256:missing'), true)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /sha256:missing/)
})

test('imageRequestTarget clamps maxBytes to REQUEST_IMAGE_MAX_BYTES', async () => {
  const { DumateAdapter } = await import('../src/adapter.js')
  const { ApiAdapter } = await import('../src/adapter-api.js')
  const cookieAdapter = new DumateAdapter({ store: {}, tokens: {}, pool: {} })
  const apiAdapter = new ApiAdapter({ store: {} })

  assert.deepEqual(cookieAdapter.imageRequestTarget('dumate', 'deepseek-v41-flash', { width: 2152, height: 882, bytes: 70_405 }), {
    width: 2152,
    height: 882,
    maxBytes: 70_405,
  })
  assert.deepEqual(cookieAdapter.imageRequestTarget('dumate', 'deepseek-v41-flash', { width: 4000, height: 3000, bytes: 5_000_000 }), {
    width: 4000,
    height: 3000,
    maxBytes: REQUEST_IMAGE_MAX_BYTES,
  })
  assert.deepEqual(apiAdapter.imageRequestTarget('dumate-api', 'm', { width: 1000, height: 1000, bytes: 9_000_000 }), {
    width: 1000,
    height: 1000,
    maxBytes: REQUEST_IMAGE_MAX_BYTES,
  })
})
