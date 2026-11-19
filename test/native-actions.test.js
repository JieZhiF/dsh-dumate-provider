import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * End-to-end check of the native handlers through the dsh-go test host, when
 * the plugin kit is installed. The unit tests above only exercise the view
 * builders; a handler that throws (a stale binding, a typo in the action name)
 * would otherwise reach the phone as "handler failed".
 */
const kit = path.join(process.env.DSH_HOME ?? path.join(process.env.HOME ?? '', '.dsh'), 'skills', 'dsh-go-plugin', 'kit', 'lib', 'testing.js')

test('every declared native action answers the bridge', { skip: !existsSync(kit) }, async () => {
  const dir = path.resolve(import.meta.dirname, '..')
  const home = mkdtempSync(path.join(tmpdir(), 'dumate-native-'))
  const saved = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const { createTestHost } = await import(kit)
    const host = createTestHost({ dir })
    const mod = await import(path.join(dir, 'index.js'))
    await mod.apply(host.ctx, {})

    const unknown = await host.invoke('dumate', { surface: 'panel', action: 'manage', value: { op: 'nope' } })
    assert.equal(unknown.effects[0].type, 'toast')

    const login = await host.invoke('dumate', { surface: 'panel', action: 'manage', value: { op: 'open-login' } })
    assert.equal(login.effects[0].type, 'link')
    assert.match(login.effects[0].url, /^https:\/\/login\.bce\.baidu\.com\//)

    const again = await host.invoke('dumate', { surface: 'panel', action: 'manage', value: { op: 'open-login' } })
    assert.equal(again.effects[0].type, 'toast', 'a second tap within 5 s must not open another intent')

    const models = await host.invoke('dumate', { surface: 'panel', action: 'manage', value: { op: 'open-models' } })
    assert.equal(models.effects[0].type, 'open')
  } finally {
    if (saved === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = saved
    rmSync(home, { recursive: true, force: true })
  }
})
