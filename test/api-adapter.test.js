/**
 * API lane: an OpenAI-compatible endpoint behind the `dumate-api` route.
 *
 * A local mock server stands in for the enterprise endpoint, so this exercises
 * the real adapter (request shape, SSE decoding, tool calls, usage) without a
 * key or network access.
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'

import { ApiAdapter, apiCatalog, accountForModel, completionsUrl } from '../src/adapter-api.js'
import { Store } from '../src/store.js'

/** One SSE body: reasoning, text, a tool call, usage, then [DONE]. */
const SSE_BODY = [
  'data: {"choices":[{"delta":{"reasoning_content":"先想一下"}}]}',
  '',
  'data: {"choices":[{"delta":{"content":"好的"}}]}',
  '',
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_x","function":{"name":"get_weather","arguments":"{\\"city\\":\\"北京\\"}"}}]}}]}',
  '',
  'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
  '',
  'data: {"choices":[],"usage":{"prompt_tokens":20,"completion_tokens":7,"total_tokens":27}}',
  '',
  'data: [DONE]',
  '',
  '',
].join('\n')

/** Start a mock endpoint and return its base URL plus a request recorder. */
async function mockEndpoint() {
  const seen = []
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'mock-model' }, { id: 'mock-tool' }] }))
      return
    }
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      seen.push({ url: req.url, auth: req.headers.authorization, body: body === '' ? undefined : JSON.parse(body) })
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end(SSE_BODY)
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return { baseURL: `http://127.0.0.1:${port}/v1`, seen, close: () => new Promise(resolve => server.close(resolve)) }
}

async function storeWithApi(baseURL) {
  const store = new Store({ file: '/tmp/api-adapter-test-state.json', logger: { info() {}, warn() {} } })
  await store.load()
  store.get().apiAccounts = [{
    id: 'api1',
    label: 'mock',
    baseURL,
    apiKey: 'sk-test',
    enabled: true,
    createdAt: Date.now(),
    lastError: '',
    lastOkAt: 0,
    models: [
      { id: 'mock-model', name: 'Mock', context: 128_000, maxOutput: 4096, vision: false },
      { id: 'mock-tool', name: 'Mock Tool', context: 128_000, maxOutput: 4096, vision: true },
    ],
  }]
  return store
}

test('completionsUrl normalizes the base URL', () => {
  assert.equal(completionsUrl('https://api.example.com/v1/'), 'https://api.example.com/v1/chat/completions')
  assert.equal(completionsUrl('https://api.example.com/v1/chat/completions'), 'https://api.example.com/v1/chat/completions')
})

test('apiCatalog and accountForModel flatten enabled accounts only', () => {
  const accounts = [
    { enabled: true, models: [{ id: 'a' }, { id: 'b' }] },
    { enabled: false, models: [{ id: 'c' }] },
    { enabled: true, models: [{ id: 'a' }, { id: 'd' }] },
  ]
  assert.deepEqual(apiCatalog(accounts).map(model => model.id), ['a', 'b', 'd'])
  assert.equal(accountForModel(accounts, 'b')?.models[0].id, 'a')
  assert.equal(accountForModel(accounts, 'c'), undefined)
})

test('ApiAdapter streams text, reasoning, tool calls and usage from a mock endpoint', async () => {
  const mock = await mockEndpoint()
  try {
    const store = await storeWithApi(mock.baseURL)
    const adapter = new ApiAdapter({ store, logger: {} })
    const chunks = []
    for await (const chunk of adapter.stream({
      provider: 'dumate-api',
      model: 'mock-model',
      messages: [{ role: 'user', content: [{ type: 'text', text: '北京天气？' }] }],
    })) {
      chunks.push(chunk)
    }
    assert.equal(mock.seen.length, 1)
    assert.equal(mock.seen[0].url, '/v1/chat/completions')
    assert.equal(mock.seen[0].auth, 'Bearer sk-test')
    assert.equal(mock.seen[0].body.model, 'mock-model')
    assert.equal(mock.seen[0].body.stream, true)

    const types = chunks.map(chunk => chunk.type)
    assert.ok(types.includes('reasoning-delta'))
    assert.ok(types.includes('text-delta'))
    assert.ok(types.includes('tool-call-delta'))
    const toolEnd = chunks.find(chunk => chunk.type === 'block-end' && chunk.block?.type === 'tool-call')
    assert.equal(toolEnd.block.name, 'get_weather')
    assert.equal(JSON.parse(toolEnd.block.arguments).city, '北京')
    const usage = chunks.find(chunk => chunk.type === 'usage')
    assert.equal(usage.usage.inputTokens, 20)
    assert.equal(usage.usage.outputTokens, 7)
    const finish = chunks.at(-1)
    assert.deepEqual(finish.reason, { kind: 'tool-calls' })
  } finally {
    await mock.close()
  }
})

test('ApiAdapter reports a readable failure for an unknown model', async () => {
  const store = await storeWithApi('http://127.0.0.1:1/v1')
  const adapter = new ApiAdapter({ store, logger: {} })
  await assert.rejects(async () => {
    for await (const _chunk of adapter.stream({ provider: 'dumate-api', model: 'nope', messages: [] })) {
      // no chunks expected
    }
  }, /没有 API 账号提供模型/)
})
