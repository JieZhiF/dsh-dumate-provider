/**
 * Pure-logic tests for the host half. No network, no DSH: everything here is
 * the projection code that a wrong edit would corrupt silently.
 *
 * Run with `npm test`.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { buildBody, finishReasonOf, mapUsage, readSse, toWireMessages } from '../src/wire.js'
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
