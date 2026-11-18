/**
 * Client-half projections, loaded through the real ModuleLoader bundle.
 *
 * The component needs React and a DOM, but the pure helpers do not; exporting
 * them as `__test` keeps this test against the shipped file instead of a copy.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const ReactStub = {
  createElement: () => ({}),
  Fragment: 'fragment',
  useState: v => [v, () => {}],
  useEffect: () => {},
  useCallback: f => f,
  useMemo: f => f(),
  useRef: v => ({ current: v }),
}

const sandbox = { window: { __ModuleLoader__: { load: spec => { sandbox.spec = spec } } }, document: { documentElement: { lang: 'zh-CN' } }, setInterval: () => 0, clearInterval: () => {}, console }
vm.createContext(sandbox)
vm.runInContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), sandbox, { filename: 'client.js' })
const mod = sandbox.spec.factory(name => (name === 'react' ? ReactStub : {}))

test('planOf reads the active plan_* package', () => {
  const t = (key, vars) => (vars === undefined ? key : `${key}:${JSON.stringify(vars)}`)
  const balance = {
    packages: [
      { packageType: 'plan_pro', active: true, expireAt: Date.UTC(2026, 11, 1) },
      { packageType: 'grant_point', active: true, expireAt: 0 },
    ],
  }
  const plan = mod.__test.planOf(balance, t)
  assert.equal(plan.tone, 'info')
  assert.match(plan.label, /PRO/)
})

test('planOf falls back to the free tier without a plan package', () => {
  const t = key => key
  const plan = mod.__test.planOf({ packages: [{ packageType: 'grant_point', active: true }] }, t)
  assert.equal(plan.label, 'planFree')
  assert.equal(plan.tone, 'muted')
})

test('planOf ignores an expired plan package', () => {
  const t = (key, vars) => (vars === undefined ? key : `${key}`)
  const plan = mod.__test.planOf({ packages: [{ packageType: 'plan_max', active: false }] }, t)
  assert.equal(plan.label, 'planFree')
})

test('translate interpolates the active language', () => {
  const zh = mod.__test.translate('zh-CN', 'streak', { n: 3 })
  assert.match(zh, /3/)
  const en = mod.__test.translate('en-US', 'streak', { n: 3 })
  assert.match(en, /3/)
  assert.notEqual(zh, en)
})
