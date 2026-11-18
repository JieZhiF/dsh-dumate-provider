/**
 * The DuMate provider adapter.
 *
 * Written against the harness adapter contract structurally — an object with
 * `providerInfo`, `listModels`, `resolveModel`, `prepareCall` and `stream` —
 * rather than by subclassing a version-pinned base class. That is deliberate:
 * this plugin must mount on both the 0.2.1 and 0.2.2 host lines, and a
 * structural implementation cannot break because a base class moved.
 *
 * Account failover happens here, before the first token reaches the caller.
 * Once a chunk has been handed over the answer belongs to the session, so a
 * later upstream failure is reported rather than retried on another account.
 *
 * @module src/adapter
 */
import { CHAT_BASE, CHAT_PATH, MODELS, PROVIDER_NAME, USER_AGENT, modelInfo } from './constants.js'
import { openStream } from './http.js'
import { BlockWriter, buildBody, finishReasonOf, mapUsage, readSse } from './wire.js'

/** Default output ceiling when a catalog row is missing. */
const FALLBACK_MAX_TOKENS = 32_768

/** Context the catalog does not describe. */
const FALLBACK_CONTEXT = 200_000

/** One classified transport / provider failure. */
export class DumateError extends Error {
  constructor(message, { code = 'UPSTREAM', status = 0, retryable = false } = {}) {
    super(message)
    this.name = 'DumateError'
    this.code = code
    this.status = status
    this.retryable = retryable
  }
}

/** Turn an HTTP status into the failure shape the harness understands. */
function classifyStatus(status, body) {
  const detail = typeof body === 'string' && body !== '' ? body.slice(0, 300) : ''
  if (status === 401 || status === 403) {
    return new DumateError(`搭子网关拒绝了登录凭证 (HTTP ${status})：Cookie 可能已过期，请在设置页重新登录`, { code: 'AUTH', status, retryable: false })
  }
  if (status === 429) {
    return new DumateError(`搭子网关限流 (HTTP 429)${detail === '' ? '' : `：${detail}`}`, { code: 'RATE_LIMIT', status, retryable: true })
  }
  if (status >= 500) {
    return new DumateError(`搭子网关故障 (HTTP ${status})${detail === '' ? '' : `：${detail}`}`, { code: 'SERVER', status, retryable: true })
  }
  return new DumateError(`搭子网关拒绝请求 (HTTP ${status})${detail === '' ? '' : `：${detail}`}`, { code: 'INVALID_REQUEST', status, retryable: false })
}

export class DumateAdapter {
  /**
   * @param {object} options
   * @param {import('./store.js').Store} options.store
   * @param {import('./auth.js').TokenPool} options.tokens
   * @param {import('./pool.js').AccountPool} options.pool
   * @param {{info?:Function, warn?:Function}} [options.logger]
   */
  constructor(options) {
    this.store = options.store
    this.tokens = options.tokens
    this.pool = options.pool
    this.logger = options.logger ?? {}
  }

  /** Adapter contract: one route, one display name. */
  providerInfo(provider) {
    return { id: provider, name: PROVIDER_NAME }
  }

  /**
   * Retry policy for this route.
   *
   * `registerAdapter` calls this unconditionally and falls back to the normal
   * defaults when it answers `undefined`. Account failover already happens
   * inside `stream`, so the harness should not retry a failed stream on its
   * own: returning `undefined` keeps the standard policy, which is what every
   * provider without a special budget wants.
   */
  providerRetryPolicy(_provider) {
    return undefined
  }

  /** No provider-side image pricing contract on this lane. */
  imageRequestPricing(_provider, _model) {
    return undefined
  }

  /** The default projection: preserve the normalized image as-is. */
  imageRequestTarget(_provider, _model, image) {
    return { width: image?.width, height: image?.height, maxBytes: image?.bytes }
  }

  /**
   * Advertised catalog. A model the user switched off is absent here, which is
   * the whole filtering mechanism: the picker lists exactly this array.
   */
  async listModels(provider) {
    const enabled = new Set(this.store.enabledModels())
    return MODELS.filter(entry => enabled.has(entry.id)).map(entry => ({
      provider,
      id: entry.id,
      name: entry.name,
      inputModalities: entry.vision ? ['text', 'image'] : ['text'],
    }))
  }

  /** Full metadata for one exact model. */
  async resolveModel(provider, model) {
    const entry = modelInfo(model)
    if (entry === undefined) {
      return {
        provider,
        id: model,
        name: model,
        context: { contextWindow: FALLBACK_CONTEXT },
        defaultMaxTokens: FALLBACK_MAX_TOKENS,
      }
    }
    return {
      provider,
      id: entry.id,
      name: entry.name,
      inputModalities: entry.vision ? ['text', 'image'] : ['text'],
      context: { contextWindow: entry.context },
      defaultMaxTokens: Math.min(entry.maxOutput, FALLBACK_MAX_TOKENS),
    }
  }

  /** Bind metadata and dispatch to one generation, as the contract asks. */
  async prepareCall(provider, model) {
    const entry = modelInfo(model) ?? null
    return {
      model: await this.resolveModel(provider, model),
      stream: options => this.stream({ ...options, provider, model }),
    }
  }

  /**
   * Stream one call, failing over between accounts only while nothing has been
   * yielded yet.
   */
  async *stream(options) {
    const entry = modelInfo(options.model) ?? null
    const tried = new Set()
    let attempts = 0
    let lastError
    while (attempts < Math.max(1, Math.min(3, this.pool.ready().length))) {
      if (options.signal?.aborted === true) {
        yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'request aborted', code: 'ABORTED' } } }
        return
      }
      const account = this.pool.pick({ exclude: tried })
      if (account === undefined) break
      attempts += 1
      tried.add(account.id)

      const token = await this.tokens.token(account.id, account.cookie)
      if (!token.ok) {
        lastError = new DumateError(token.error ?? '无法获取搭子 token', { code: token.expired === true ? 'AUTH' : 'TRANSPORT', retryable: token.expired !== true })
        this.pool.markFailure(account.id, { message: lastError.message, auth: token.expired === true })
        continue
      }

      const iterator = this.#call(options, entry, account, token.token)[Symbol.asyncIterator]()
      let first
      try {
        first = await iterator.next()
      } catch (error) {
        // Nothing was handed over yet, so this account may be swapped out.
        const failure = this.#classify(error)
        this.pool.markFailure(account.id, { message: failure.message, status: failure.status, auth: failure.code === 'AUTH' })
        if (failure.code === 'AUTH') this.tokens.invalidate(account.id)
        lastError = failure
        continue
      }
      if (first.done === true) return
      yield first.value
      try {
        for (;;) {
          if (options.signal?.aborted === true) {
            yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'request aborted', code: 'ABORTED' } } }
            return
          }
          const step = await iterator.next()
          if (step.done === true) break
          yield step.value
        }
      } catch (error) {
        const failure = this.#classify(error)
        this.pool.markFailure(account.id, { message: failure.message, status: failure.status, auth: failure.code === 'AUTH' })
        throw failure
      }
      this.pool.markSuccess(account.id)
      this.store.update(state => {
        const stored = state.accounts.find(candidate => candidate.id === account.id)
        if (stored !== undefined) {
          stored.lastOkAt = Date.now()
          stored.lastError = ''
        }
      })
      return
    }

    if (lastError !== undefined) throw lastError
    throw new DumateError(
      this.pool.ready().length === 0
        ? '没有可用的搭子账号：请到「设置 → 百度搭子」粘贴 Cookie 或启用账号'
        : '所有搭子账号暂时都不可用（冷却中或凭证失效），请稍后重试',
      { code: 'NO_ACCOUNT', retryable: false },
    )
  }

  /** Normalize any thrown value into the classified failure shape. */
  #classify(error) {
    if (error instanceof DumateError) return error
    const status = Number.isFinite(error?.status) ? error.status : 0
    const message = typeof error?.message === 'string' && error.message !== '' ? error.message : String(error)
    if (status !== 0) return classifyStatus(status, error?.body)
    return new DumateError(`连接搭子网关失败：${message}`, { code: 'TRANSPORT', status: 0, retryable: true })
  }

  /**
   * One account's turn: token in hand, open the SSE stream and translate it.
   *
   * Throws before yielding anything when the request is refused, which is what
   * lets the caller fail over; throws after yielding only for a genuine
   * mid-stream failure, which the caller reports.
   */
  async *#call(options, entry, account, token) {
    const body = buildBody(options, entry)
    const payload = JSON.stringify(body)
    let response
    try {
      response = await openStream(`${CHAT_BASE}${CHAT_PATH}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'text/event-stream',
          'user-agent': USER_AGENT,
          // The first-party client sends these; mirroring it is the least
          // surprising thing the gateway can see.
          'x-dumate-client-type': 'web',
          'x-dumate-account-id': 'global',
        },
        body: payload,
        timeoutMs: 300_000,
        signal: options.signal,
      })
    } catch (error) {
      throw this.#classify(error)
    }

    const writer = new BlockWriter()
    let usage
    let finishReason
    try {
      for await (const event of readSse(response, options.signal)) {
        if (event.done === true) break
        let frame
        try {
          frame = JSON.parse(event.data)
        } catch {
          continue
        }
        if (frame?.error !== undefined) {
          const message = typeof frame.error === 'string' ? frame.error : frame.error?.message ?? JSON.stringify(frame.error)
          throw new DumateError(`搭子网关返回错误：${String(message).slice(0, 300)}`, { code: 'UPSTREAM', retryable: true })
        }
        const choice = Array.isArray(frame?.choices) ? frame.choices[0] : undefined
        if (choice !== undefined && choice !== null) {
          const delta = choice.delta ?? {}
          if (typeof delta.reasoning_content === 'string') writer.reasoning(delta.reasoning_content)
          else if (typeof delta.reasoning === 'string') writer.reasoning(delta.reasoning)
          if (typeof delta.content === 'string') writer.text(delta.content)
          if (Array.isArray(delta.tool_calls)) for (const call of delta.tool_calls) writer.tool(call)
          if (typeof choice.finish_reason === 'string') finishReason = choice.finish_reason
        }
        if (frame?.usage !== undefined && frame.usage !== null) usage = frame.usage
        for (const chunk of writer.drain()) yield chunk
      }
    } finally {
      response.destroy()
    }

    writer.closeAll()
    for (const chunk of writer.drain()) yield chunk
    const mapped = mapUsage(usage)
    if (mapped !== undefined) yield { type: 'usage', usage: mapped }
    yield {
      type: 'finish',
      reason: writer.sawToolCall ? { kind: 'tool-calls' } : finishReasonOf(finishReason, false, writer.sawText),
    }
  }
}
