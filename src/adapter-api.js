/**
 * Optional API lane: an OpenAI-compatible endpoint with an API key.
 *
 * The personal DuMate tier has no API, so this lane exists for accounts that do
 * have one — the enterprise Agent API when it exposes an OpenAI-compatible
 * surface, or any gateway/self-hosted endpoint in front of the same models.
 * It is deliberately separate from the cookie lane: a different provider route
 * (`dumate-api`), its own model list from configuration, and its own auth.
 *
 * @module src/adapter-api
 */
import { ROUTE_API, PROVIDER_NAME_API } from './constants.js'
import { openStream } from './http.js'
import { BlockWriter, IMAGE_BUDGET, REQUEST_IMAGE_MAX_BYTES, buildBody, finishReasonOf, mapUsage, prepareRequestImages, readSse } from './wire.js'

/** Normalize a configured base URL: no trailing slash, `/chat/completions` appended. */
export function completionsUrl(baseURL) {
  const trimmed = String(baseURL ?? '').trim().replace(/\/+$/, '')
  return trimmed.endsWith('/chat/completions') ? trimmed : `${trimmed}/chat/completions`
}

/** Flatten every enabled API account's models into one catalog (first id wins). */
export function apiCatalog(apiAccounts) {
  const seen = new Set()
  const models = []
  for (const account of apiAccounts ?? []) {
    if (account?.enabled === false) continue
    for (const model of account.models ?? []) {
      if (typeof model?.id !== 'string' || model.id === '' || seen.has(model.id)) continue
      seen.add(model.id)
      models.push(model)
    }
  }
  return models
}

/** One account that serves a given model id. */
export function accountForModel(apiAccounts, modelId) {
  return (apiAccounts ?? []).find(account =>
    account?.enabled !== false
    && (account.models ?? []).some(model => model.id === modelId))
}

export class ApiAdapter {
  /**
   * @param {object} options
   * @param {import('./store.js').Store} options.store
   * @param {() => ({readImageRequest?:Function, imageLimits?:object}|undefined)} [options.attachments]
   * @param {{info?:Function, warn?:Function}} [options.logger]
   */
  constructor(options) {
    this.store = options.store
    this.attachments = options.attachments
    this.logger = options.logger ?? {}
  }

  providerInfo(provider) {
    return { id: provider, name: PROVIDER_NAME_API }
  }

  providerRetryPolicy(_provider) {
    return undefined
  }

  imageRequestPricing(_provider, _model) {
    return undefined
  }

  imageRequestTarget(_provider, _model, image) {
    return {
      width: image?.width,
      height: image?.height,
      maxBytes: Math.min(image?.bytes ?? REQUEST_IMAGE_MAX_BYTES, REQUEST_IMAGE_MAX_BYTES),
    }
  }

  async listModels(provider) {
    return apiCatalog(this.store.get().apiAccounts).map(model => ({
      provider,
      id: model.id,
      name: model.name || model.id,
      inputModalities: model.vision === true ? ['text', 'image'] : ['text'],
    }))
  }

  async resolveModel(provider, model) {
    const entry = apiCatalog(this.store.get().apiAccounts).find(candidate => candidate.id === model)
    return {
      provider,
      id: model,
      name: entry?.name || model,
      inputModalities: entry?.vision === true ? ['text', 'image'] : ['text'],
      context: { contextWindow: entry?.context ?? 200_000 },
      defaultMaxTokens: Math.min(entry?.maxOutput ?? 32_768, 32_768),
    }
  }

  async prepareCall(provider, model) {
    return {
      model: await this.resolveModel(provider, model),
      stream: options => this.stream({ ...options, provider, model }),
    }
  }

  async *stream(options) {
    const account = accountForModel(this.store.get().apiAccounts, options.model)
    if (account === undefined) {
      throw new Error(`没有 API 账号提供模型 ${options.model}：请在「设置 → 百度搭子 → API 接入」里添加或启用`)
    }
    const model = (account.models ?? []).find(entry => entry.id === options.model)
    const vision = model?.vision === true
    const images = vision
      ? await prepareRequestImages(options.messages, this.attachments?.(), IMAGE_BUDGET, options.signal, this.logger)
      : undefined
    const body = buildBody({ ...options, images }, { maxOutput: model?.maxOutput, vision })
    let response
    try {
      response = await openStream(completionsUrl(account.baseURL), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${account.apiKey}`,
          'content-type': 'application/json',
          accept: 'text/event-stream',
        },
        body: JSON.stringify(body),
        timeoutMs: 300_000,
        signal: options.signal,
      })
    } catch (error) {
      const status = Number.isFinite(error?.status) ? error.status : 0
      const detail = status === 401 ? '（API Key 被拒绝）' : ''
      throw new Error(`API 端点返回 HTTP ${status || 'network error'}${detail}：${error?.message ?? ''}`)
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
        const choice = Array.isArray(frame?.choices) ? frame.choices[0] : undefined
        if (choice !== undefined && choice !== null) {
          const delta = choice.delta ?? {}
          if (typeof delta.reasoning_content === 'string') writer.reasoning(delta.reasoning_content)
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
    yield { type: 'finish', reason: writer.sawToolCall ? { kind: 'tool-calls' } : finishReasonOf(finishReason, false, writer.sawText) }
  }
}
