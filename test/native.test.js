import test from 'node:test'
import assert from 'node:assert/strict'

import { cookieFrom, modelsView, overviewView, stripText } from '../src/native.js'
import { createHandlers, routeKey } from '../src/routes.js'

/** A `/state` body shaped like the one the web page receives. */
function snapshot(overrides = {}) {
  return {
    ok: true,
    version: '1.5.0',
    accounts: [
      {
        id: 'a1',
        name: '搭子甲',
        enabled: true,
        hasCookie: true,
        lastError: '',
        checkin: { date: new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10), ok: true, points: 200, at: Date.now() },
        balance: { remaining: 12_345, used: 20, granted: 12_365, at: Date.now() },
      },
      { id: 'a2', name: '搭子乙', enabled: false, hasCookie: true, lastError: '', balance: { remaining: 0, at: 0 } },
    ],
    models: Array.from({ length: 22 }, (_, index) => ({ id: `m${index}`, label: `模型${index}`, enabled: index % 2 === 0 })),
    summary: { accountCount: 2, enabledCount: 1, remaining: 12_345, used: 20, granted: 12_365, lowBalance: false },
    runs: [{ at: 1_700_000_000_000, accountId: 'a1', name: '搭子甲', ok: true, message: '签到成功，+200 积分' }],
    ...overrides,
  }
}

test('strip text stays inside the 24-char strip limit', () => {
  assert.ok(stripText(undefined).length <= 24)
  assert.ok(stripText(snapshot()).length <= 24)
  assert.ok(stripText(snapshot({ summary: { accountCount: 0 } })).length <= 24)
  assert.match(stripText(snapshot()), /12,345/)
  assert.equal(stripText(snapshot(), 'en-US').includes('checked in'), true)
})

test('the overview panel lists every account with its own buttons', () => {
  const view = overviewView(snapshot(), undefined, 'zh')
  const stacks = view.children.filter(child => child.type === 'stack')
  assert.equal(stacks.length, 2)
  const [first] = stacks
  const actions = first.children.find(child => child.type === 'actions')
  assert.equal(actions.items.length, 3)
  assert.deepEqual(actions.items[0].action, { id: 'manage', args: { op: 'checkin', id: 'a1' } })
  assert.match(JSON.stringify(first), /12,345/)
})

test('the overview panel explains the clipboard-first sign-in when empty', () => {
  const view = overviewView(snapshot({ accounts: [], summary: { accountCount: 0, enabledCount: 0 } }), undefined, 'zh')
  const callout = view.children.find(child => child.type === 'callout')
  assert.match(callout.text, /贴搭子 Cookie/)
})

test('a pending delete asks first and only then offers the removal', () => {
  const view = overviewView(snapshot(), 'a1', 'zh')
  assert.ok(view.children.some(child => child.type === 'options'))
  assert.match(JSON.stringify(view), /remove\|a1/)
})

test('the overview panel lists the recent check-in runs', () => {
  const view = overviewView(snapshot(), undefined, 'zh')
  const list = view.children.find(child => child.type === 'list')
  assert.equal(list.items.length, 1)
  assert.match(list.items[0].subtitle, /\+200/)
  assert.equal(list.items[0].tone, 'good')
})

test('the overview panel sends the user to the clipboard action', () => {
  const view = overviewView(snapshot(), undefined, 'zh')
  assert.equal(view.children.some(child => child.type === 'form'), false)
  assert.match(JSON.stringify(view), /贴搭子Cookie/)
  assert.match(JSON.stringify(view), /打开登录页/)
})

test('a form submit is read through every envelope the app has used', () => {
  assert.equal(cookieFrom({ cookie: 'BDUSS=abc' }), 'BDUSS=abc')
  assert.equal(cookieFrom({ data: { cookie: 'BDUSS=abc' } }), 'BDUSS=abc')
  assert.equal(cookieFrom({ value: { cookie: 'BDUSS=abc' } }), 'BDUSS=abc')
  assert.equal(cookieFrom('BDUSS=abc'), 'BDUSS=abc')
  assert.equal(cookieFrom({ op: 'refresh' }), '')
  assert.equal(cookieFrom([{ cookie: 'BDUSS=abc' }]), 'BDUSS=abc')
  assert.equal(cookieFrom({ formData: { cookie: 'BDUSS=abc' } }), 'BDUSS=abc')
  assert.equal(cookieFrom({ whatever: { deeper: 'x=1; BDUSS=abc; y=2' } }), 'x=1; BDUSS=abc; y=2')
})

test('the models panel exposes all 22 switches plus the bulk buttons', () => {
  const view = modelsView(snapshot(), 'zh')
  const rows = view.children.filter(child => child.type === 'actions' && child.items[0].label.startsWith('✓'))
  assert.equal(rows.length, 11)
  assert.match(JSON.stringify(view), /全部开启/)
})

test('routeKey folds separators the way the HTTP table expects', () => {
  assert.equal(routeKey('GET', ''), 'GET_state')
  assert.equal(routeKey('POST', 'account/add'), 'POST_account_add')
  assert.equal(routeKey('POST', 'api-account/probe/'), 'POST_api_account_probe')
})

test('the in-process call answers from the same handler table as HTTP', async () => {
  const { invoke } = createHandlers({ version: '1.5.0' })
  const ping = await invoke('GET', 'ping')
  assert.equal(ping.status, 200)
  assert.equal(ping.body.ok, true)
  const missing = await invoke('GET', 'no-such-route')
  assert.equal(missing.status, 404)
  assert.equal(missing.body.ok, false)
})
