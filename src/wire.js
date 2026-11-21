/**
 * Harness request → DuMate wire body, and SSE → harness stream chunks.
 *
 * The gateway speaks OpenAI Chat Completions: `messages`, `tools` as
 * `{type:'function'}`, `stream: true` SSE frames terminated by `data: [DONE]`,
 * reasoning in `delta.reasoning_content`, and tool calls in
 * `delta.tool_calls[{index,id,type,function:{name,arguments}}]`.
 *
 * Everything here is pure projection: no I/O, no retry, no state.
 *
 * @module src/wire
 */
import { StringDecoder } from 'node:string_decoder'

import { supportsReasoning } from './constants.js'

/** Placeholder sent when a non-vision model receives an image block. */
export const IMAGE_PLACEHOLDER = '[图片已省略：当前模型不支持视觉输入 / image omitted: this model is text-only]'

/** Per-image encoded byte ceiling before base64 expansion. */
export const REQUEST_IMAGE_MAX_BYTES = 1_048_576
/** Maximum number of images sent in a single request. */
export const REQUEST_IMAGE_MAX_COUNT = 8
/** Total image byte budget across a single request (before base64 expansion). */
export const REQUEST_IMAGE_TOTAL_BYTES = 4_194_304
/** Default request-level image budget shared by prepareRequestImages and imageRequestTarget. */
export const IMAGE_BUDGET = Object.freeze({
  maxImages: REQUEST_IMAGE_MAX_COUNT,
  maxBytes: REQUEST_IMAGE_MAX_BYTES,
  maxTotalBytes: REQUEST_IMAGE_TOTAL_BYTES,
})

function imageIdentity(ref) {
  if (ref === null || typeof ref !== 'object') return 'unknown'
  const id = typeof ref.attachmentId === 'string' && ref.attachmentId !== '' ? ref.attachmentId : 'unknown'
  return typeof ref.name === 'string' && ref.name !== '' ? `${JSON.stringify(ref.name)} (${id})` : id
}

/** Model-facing handle paired with one inline request image. */
export function imageHandleText(ref, version) {
  const dims = Number.isFinite(version?.width) && Number.isFinite(version?.height) ? ` request preview ${version.width}x${version.height}px.` : ''
  return `Image ${imageIdentity(ref)};${dims} It may be resized or re-encoded; source dimensions, format, and byte size may differ.`
}

/** Fallback text when an image is omitted (text-only model, budget limit, or unreadable attachment). */
export function imagePlaceholderText(ref, vision) {
  if (!vision) return IMAGE_PLACEHOLDER
  return `[图片已省略：超出单次请求预算或附件不可读（${imageIdentity(ref)}）/ image omitted to fit request image limits; ${imageIdentity(ref)}]`
}

/**
 * Pre-read and normalize every unique image referenced by `messages` within `budget`.
 *
 * Attachment read failures are swallowed (logged via `logger?.warn` when provided)
 * so a missing or corrupted disk object degrades that single image to a placeholder
 * instead of failing the turn or triggering account failover. Abort signals are
 * respected and rethrown.
 *
 * @param {Array<object>} messages
 * @param {{readImageRequest?:Function, imageLimits?:object}|undefined} attachments
 * @param {{maxImages?:number, maxBytes?:number, maxTotalBytes?:number}} [budget]
 * @param {AbortSignal} [signal]
 * @param {{warn?:Function}} [logger]
 * @returns {Promise<{versions:Map<string,object>, skipped:Set<string>}>}
 */
export async function prepareRequestImages(messages, attachments, budget = IMAGE_BUDGET, signal, logger) {
  const versions = new Map()
  const skipped = new Set()
  if (typeof attachments?.readImageRequest !== 'function') return { versions, skipped }

  const maxImages = Number.isFinite(budget?.maxImages) && budget.maxImages > 0 ? budget.maxImages : REQUEST_IMAGE_MAX_COUNT
  const limitBytes = Number.isFinite(attachments?.imageLimits?.maxImageBytes) && attachments.imageLimits.maxImageBytes > 0
    ? attachments.imageLimits.maxImageBytes
    : Infinity
  const maxBytes = Math.min(
    limitBytes,
    Number.isFinite(budget?.maxBytes) && budget.maxBytes > 0 ? budget.maxBytes : REQUEST_IMAGE_MAX_BYTES,
  )
  const maxTotalBytes = Number.isFinite(budget?.maxTotalBytes) && budget.maxTotalBytes > 0
    ? budget.maxTotalBytes
    : REQUEST_IMAGE_TOTAL_BYTES

  const refs = new Map()
  for (const message of messages ?? []) {
    if (message === null || typeof message !== 'object' || !Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (block?.type !== 'image' || block.offloaded === true) continue
      const ref = block.attachment
      const id = ref?.attachmentId
      if (typeof id !== 'string' || id === '') continue
      if (!refs.has(id)) refs.set(id, ref)
    }
  }
  if (refs.size === 0) return { versions, skipped }

  const orderedRefs = [...refs.values()]
  const candidates = orderedRefs.slice(0, maxImages)
  for (const extra of orderedRefs.slice(maxImages)) skipped.add(extra.attachmentId)

  const results = await Promise.all(
    candidates.map(async ref => {
      if (signal?.aborted === true) throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')
      const target = {
        width: ref.width,
        height: ref.height,
        maxBytes: Math.min(Number.isFinite(ref.bytes) && ref.bytes > 0 ? ref.bytes : maxBytes, maxBytes),
      }
      try {
        const version = await attachments.readImageRequest(ref, target, signal)
        return { ref, version }
      } catch (error) {
        if (signal?.aborted === true || error?.name === 'AbortError') throw error
        logger?.warn?.(`dumate-provider: image attachment ${ref.attachmentId} skipped: ${error?.message ?? error}`)
        return { ref, version: undefined }
      }
    }),
  )

  let totalBytes = 0
  for (const { ref, version } of results) {
    const id = ref.attachmentId
    const bytes = Number.isFinite(version?.bytes) ? version.bytes : version?.data?.byteLength ?? 0
    if (version === undefined || version === null || !version.data || bytes <= 0 || bytes > maxBytes || totalBytes + bytes > maxTotalBytes) {
      skipped.add(id)
      continue
    }
    totalBytes += bytes
    versions.set(id, version)
  }

  return { versions, skipped }
}

/** Placeholder sent for a file reference, which never reaches a provider natively. */
function filePlaceholder(block) {
  const name = block?.attachment?.name ?? block?.attachment?.filename ?? 'file'
  return `[附件 ${name}]`
}

/** Join the text blocks of one message. */
function textOf(blocks) {
  return blocks
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('')
}

/**
 * Project harness messages onto Chat Completions messages.
 *
 * @param {Array<object>} messages - `GenerateOptions.messages`.
 * @param {object} [options]
 * @param {string} [options.system] - one-shot system prompt to prepend.
 * @param {boolean} [options.vision] - whether the target model accepts images.
 * @param {{versions?:Map<string,object>, skipped?:Set<string>}} [options.images] - pre-read request images.
 * @returns {Array<object>}
 */
export function toWireMessages(messages, options = {}) {
  const wire = []
  const systemParts = []
  if (typeof options.system === 'string' && options.system.trim() !== '') systemParts.push(options.system)
  const versions = options.images?.versions

  for (const message of messages ?? []) {
    if (message === null || typeof message !== 'object') continue
    const blocks = Array.isArray(message.content) ? message.content : []
    switch (message.role) {
      case 'system': {
        const text = textOf(blocks)
        if (text !== '') systemParts.push(text)
        break
      }
      case 'user': {
        const parts = []
        for (const block of blocks) {
          if (block?.type === 'text' && typeof block.text === 'string') {
            if (block.text !== '') parts.push({ type: 'text', text: block.text })
          } else if (block?.type === 'image') {
            const id = block.attachment?.attachmentId
            const version = options.vision === true && id !== undefined ? versions?.get(id) : undefined
            if (version !== undefined) {
              parts.push({ type: 'text', text: imageHandleText(block.attachment, version) })
              parts.push({
                type: 'image_url',
                image_url: { url: `data:${version.mediaType};base64,${Buffer.from(version.data).toString('base64')}` },
              })
            } else {
              parts.push({ type: 'text', text: imagePlaceholderText(block.attachment, options.vision === true) })
            }
          } else if (block?.type === 'file') {
            parts.push({ type: 'text', text: filePlaceholder(block) })
          }
        }
        if (parts.length === 0) break
        const content = parts.every(part => part.type === 'text')
          ? parts.map(part => part.text).join('')
          : parts
        if (content !== '') wire.push({ role: 'user', content })
        break
      }
      case 'assistant': {
        const content = textOf(blocks)
        const toolCalls = blocks
          .filter(block => block?.type === 'tool-call')
          .map(block => ({
            id: typeof block.id === 'string' && block.id !== '' ? block.id : `call_${Math.random().toString(36).slice(2, 12)}`,
            type: 'function',
            function: { name: block.name, arguments: typeof block.arguments === 'string' && block.arguments !== '' ? block.arguments : '{}' },
          }))
        const out = { role: 'assistant' }
        if (content !== '') out.content = content
        if (toolCalls.length > 0) {
          out.tool_calls = toolCalls
          // A tool-only assistant turn must carry a null content, not an empty string.
          if (out.content === undefined) out.content = null
        }
        if (out.content !== undefined || out.tool_calls !== undefined) wire.push(out)
        break
      }
      case 'tool': {
        const content = textOf(blocks)
        const callId = message.toolCallId ?? message.source?.callId ?? ''
        if (callId === '') break
        wire.push({ role: 'tool', tool_call_id: String(callId), content })
        break
      }
      default:
        break
    }
  }

  if (systemParts.length > 0) wire.unshift({ role: 'system', content: systemParts.join('\n\n') })
  return wire
}

/**
 * Build the Chat Completions request body.
 *
 * `stream_options.include_usage` asks the gateway for a final usage frame; a
 * gateway that ignores it simply never sends one, which the adapter tolerates.
 */
export function buildBody(options, catalogEntry) {
  const body = {
    model: options.model,
    messages: toWireMessages(options.messages, {
      system: options.system,
      vision: catalogEntry?.vision === true,
      images: options.images,
    }),
    stream: true,
    stream_options: { include_usage: true },
  }
  if (typeof options.temperature === 'number' && Number.isFinite(options.temperature)) body.temperature = options.temperature
  // The picker's effort id maps onto the gateway's vocabulary. `off` must be
  // an explicit disable — omitting reasoning_effort still thinks (verified
  // against the live gateway); `low` is normalized to `high` because the
  // Baidu channel runs them at the same strength. Only models whose upstream
  // actually honors the field reach this branch; the caller passes
  // `supportsReasoning(entry.id)` as the gate.
  if (options.reasoningEffort !== undefined && options.reasoningEffort !== null && supportsReasoning(catalogEntry?.id)) {
    const effort = String(options.reasoningEffort).toLowerCase()
    if (effort === 'off' || effort === 'none') {
      body.thinking = { type: 'disabled' }
      body.enable_thinking = false
    } else if (effort === 'low' || effort === 'high' || effort === 'max') {
      body.reasoning_effort = effort === 'low' ? 'high' : effort
      body.thinking = { type: 'enabled' }
      body.enable_thinking = true
    }
  }
  // The catalog's `maxOutput` is a ceiling, not a request default: sending it
  // verbatim would ask for 384K tokens on every call.
  const ceiling = typeof catalogEntry?.maxOutput === 'number' ? Math.min(catalogEntry.maxOutput, 32_768) : 32_768
  const maxTokens = typeof options.maxTokens === 'number' && Number.isFinite(options.maxTokens) ? options.maxTokens : ceiling
  if (typeof maxTokens === 'number' && maxTokens > 0) body.max_tokens = Math.trunc(maxTokens)
  if (Array.isArray(options.stop) && options.stop.length > 0) body.stop = options.stop
  const tools = Array.isArray(options.tools) ? options.tools : []
  if (tools.length > 0) {
    body.tools = tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: typeof tool.description === 'string' ? tool.description : '',
        parameters: tool.parameters ?? { type: 'object', properties: {} },
      },
    }))
    body.tool_choice = 'auto'
  }
  return body
}

/**
 * Yield decoded SSE `data:` payload strings from one response stream.
 *
 * Uses `StringDecoder` rather than `chunk.toString('utf8')`: a multi-byte
 * character split across two TCP chunks would otherwise arrive as U+FFFD and
 * corrupt Chinese output — the exact bug the handoff notes call out.
 *
 * @param {AsyncIterable<Buffer>} stream
 * @param {AbortSignal} [signal]
 * @returns {AsyncGenerator<{data:string}|{done:true}>}
 */
export async function* readSse(stream, signal) {
  const decoder = new StringDecoder('utf8')
  let buffer = ''
  for await (const chunk of stream) {
    if (signal?.aborted === true) return
    buffer += decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    let boundary = buffer.indexOf('\n\n')
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      const payload = parseFrame(frame)
      if (payload !== undefined) {
        if (payload === '[DONE]') {
          yield { done: true }
          return
        }
        yield { data: payload }
      }
      boundary = buffer.indexOf('\n\n')
    }
  }
  buffer += decoder.end()
  const payload = parseFrame(buffer)
  if (payload !== undefined && payload !== '[DONE]') yield { data: payload }
}

/** Extract the `data:` payload of one SSE frame, ignoring comments and other fields. */
function parseFrame(frame) {
  const lines = frame.split('\n')
  const data = []
  for (const line of lines) {
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
  }
  if (data.length === 0) return undefined
  return data.join('\n')
}

/** Map the gateway's `finish_reason` onto the harness finish vocabulary. */
export function finishReasonOf(reason, sawToolCall, sawText) {
  if (reason === 'tool_calls' || sawToolCall) return { kind: 'tool-calls' }
  if (reason === 'length' || reason === 'max_tokens') return { kind: 'max-tokens' }
  if (reason === 'content_filter') return { kind: 'stop' }
  if (reason === 'stop' || reason === undefined || reason === null) return { kind: 'stop' }
  // An unknown provider reason with no content is still a normal end.
  void sawText
  return { kind: 'stop' }
}

/**
 * Map one OpenAI `usage` object onto disjoint harness token counts.
 *
 * `inputTokens` is uncached input only: the gateway's `prompt_tokens` includes
 * cache hits, so they are subtracted back out. Absent details default to 0 —
 * `undefined` here becomes `NaN` in the session log, which rejects the turn.
 */
export function mapUsage(usage) {
  if (usage === null || typeof usage !== 'object') return undefined
  const number = value => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
  const prompt = number(usage.prompt_tokens ?? usage.input_tokens)
  const completion = number(usage.completion_tokens ?? usage.output_tokens)
  const cached = number(usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens)
  const reasoning = number(usage.completion_tokens_details?.reasoning_tokens ?? usage.output_tokens_details?.reasoning_tokens)
  const total = number(usage.total_tokens) || prompt + completion
  return {
    inputTokens: Math.max(0, prompt - cached),
    outputTokens: completion,
    totalTokens: total,
    ...(cached > 0 ? { cacheReadTokens: cached } : {}),
    ...(reasoning > 0 ? { reasoningTokens: reasoning } : {}),
  }
}

/**
 * Allocate blocks in arrival order and emit the harness's flat chunk protocol.
 *
 * A block is opened by its first delta: `block-start` → deltas → `block-end`
 * carrying the assembled content. Tool calls are keyed by the provider's
 * `tool_calls[].index`, which is what lets parallel calls interleave.
 */
export class BlockWriter {
  constructor() {
    this.nextIndex = 0
    this.blocks = new Map()
    this.pending = []
    this.sawToolCall = false
    this.sawText = false
  }

  #open(key, kind) {
    const existing = this.blocks.get(key)
    if (existing !== undefined) return existing
    const block = { index: this.nextIndex++, kind, text: '', id: '', name: '', args: '' }
    this.blocks.set(key, block)
    this.pending.push({ type: 'block-start', index: block.index, blockType: kind })
    return block
  }

  text(delta) {
    if (typeof delta !== 'string' || delta === '') return
    this.sawText = true
    const block = this.#open('text', 'text')
    block.text += delta
    this.pending.push({ type: 'text-delta', index: block.index, text: delta })
  }

  reasoning(delta) {
    if (typeof delta !== 'string' || delta === '') return
    const block = this.#open('reasoning', 'reasoning')
    block.text += delta
    this.pending.push({ type: 'reasoning-delta', index: block.index, text: delta })
  }

  /**
   * Fold one `delta.tool_calls[]` entry.
   *
   * The provider may split a call across frames: id first, name once, then
   * argument fragments. Name fragments are concatenated only when they arrive
   * on the same block and the name has not already been finalized by
   * arguments — gateways that resend the full name on every frame are handled
   * by ignoring an identical repeat.
   */
  tool(toolCall) {
    if (toolCall === null || typeof toolCall !== 'object') return
    const key = `tool:${Number.isInteger(toolCall.index) ? toolCall.index : 0}`
    const block = this.#open(key, 'tool-call')
    this.sawToolCall = true
    const fn = toolCall.function ?? {}
    if (typeof toolCall.id === 'string' && toolCall.id !== '') block.id = toolCall.id
    if (typeof fn.name === 'string' && fn.name !== '' && fn.name !== block.name) {
      block.name = block.name === '' ? fn.name : block.name + fn.name
    }
    const delta = typeof fn.arguments === 'string' ? fn.arguments : ''
    block.args += delta
    if (block.name === '' && block.id === '' && delta === '') return
    const chunk = { type: 'tool-call-delta', index: block.index, id: block.id, argumentsDelta: delta }
    if (block.name !== '') chunk.name = block.name
    this.pending.push(chunk)
  }

  /** Close every open block, in open order. */
  closeAll() {
    for (const block of this.blocks.values()) {
      if (block.kind === 'text') {
        if (block.text !== '') this.pending.push({ type: 'block-end', index: block.index, block: { type: 'text', text: block.text } })
      } else if (block.kind === 'reasoning') {
        if (block.text !== '') this.pending.push({ type: 'block-end', index: block.index, block: { type: 'reasoning', text: block.text } })
      } else if (block.kind === 'tool-call') {
        this.pending.push({
          type: 'block-end',
          index: block.index,
          block: {
            type: 'tool-call',
            id: block.id !== '' ? block.id : `call_${Math.random().toString(36).slice(2, 12)}`,
            name: block.name,
            arguments: block.args === '' ? '{}' : block.args,
          },
        })
      }
    }
    this.blocks.clear()
  }

  /** Hand over and clear everything queued since the last drain. */
  drain() {
    if (this.pending.length === 0) return []
    const out = this.pending
    this.pending = []
    return out
  }
}

