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
 * @returns {Array<object>}
 */
export function toWireMessages(messages, options = {}) {
  const wire = []
  const systemParts = []
  if (typeof options.system === 'string' && options.system.trim() !== '') systemParts.push(options.system)

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
          if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
          else if (block?.type === 'image') parts.push(options.vision === true ? '[图片]' : IMAGE_PLACEHOLDER)
          else if (block?.type === 'file') parts.push(filePlaceholder(block))
        }
        const content = parts.join('')
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
    messages: toWireMessages(options.messages, { system: options.system, vision: catalogEntry?.vision === true }),
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

