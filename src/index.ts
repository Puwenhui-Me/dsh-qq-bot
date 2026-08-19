/**
 * QQ 单聊 (C2C) bridge plugin.
 *
 * Mounts a Python botpy subprocess that owns the QQ WebSocket connection and
 * relays inbound C2C messages (text/image/file) to DSH over NDJSON stdio. Each
 * QQ peer maps to one persistent agent (multi-turn memory, resumed across
 * restarts); committed assistant text is relayed back as QQ Markdown.
 *
 * @module @deepseek-ai/dsh-qq-bot
 */

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentOptions, ModelSelection } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { isConfigured, normalizeMediaType, resolveConfig, type ResolvedConfig } from './config.ts'
import { Config } from './config.ts'
import { Bridge } from './bridge.ts'
import { PeerRegistry, type PeerRoute } from './registry.ts'
import type { InboundEvent, InboundMessage } from './protocol.ts'

export const name = 'qq-bot'
export const inject = ['agents', 'attachments', 'agentDefaultModel']

export { Config }
export type { Config as QqBotConfig, ResolvedConfig } from './config.ts'

/** Minimal structural view of the LLM service's model-info lookup. */
interface LlmLike {
  resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<{ inputModalities?: readonly string[] }>
}

function buildAgentOptions(config: ResolvedConfig, ctx: Context): AgentOptions {
  // Fall back to the deployment's default model (the Models page selection)
  // so the `{{model}}` persona variable and the request route always resolve.
  const selection = ctx.agentDefaultModel.currentSelection()
  const options: AgentOptions = {
    provider: config.provider !== '' ? config.provider : selection.provider,
    model: config.model !== '' ? config.model : selection.model,
  }
  if (config.maxTokens > 0) options.maxTokens = config.maxTokens
  return options
}

export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  if (!isConfigured(resolved)) {
    ctx.logger.warn('qq-bot: appid/secret not configured — bridge disabled')
    return
  }

  const agentOptions = buildAgentOptions(resolved, ctx)
  const hasVisionModel = resolved.visionProvider !== '' && resolved.visionModel !== ''
  const visionSelection: ModelSelection | undefined = hasVisionModel
    ? { provider: resolved.visionProvider, model: resolved.visionModel }
    : undefined
  const registry = new PeerRegistry(ctx, resolved.stateDir, resolved.cwdRoot, agentOptions, resolved.workspaceTitle, visionSelection)
  const outputTails = new Map<string, Promise<void>>()

  const bridge = new Bridge(ctx, resolved, (event) => {
    void handleEvent(event).catch((error: unknown) => {
      ctx.logger.warn(`qq-bot: inbound event failed: ${String(error)}`)
    })
  })

  function sendText(scene: 'c2c', peerId: string, text: string): void {
    bridge.send({
      type: 'send', scene, peerId,
      kind: resolved.markdown ? 'markdown' : 'text',
      payload: { text },
    })
  }

  async function handleEvent(event: InboundEvent): Promise<void> {
    if (event.type === 'ready') {
      bridge.markReady()
      ctx.logger.info('qq-bot: python bridge ready')
      return
    }
    if (event.type === 'error') {
      ctx.logger.warn(`qq-bot: python bridge error: ${event.message}`)
      return
    }
    await handleMessage(event)
  }

  async function handleMessage(message: InboundMessage): Promise<void> {
    const key = PeerRegistry.key(message.scene, message.peerId)
    let agent: Agent
    try {
      agent = await registry.ensure(key, message.peerId)
    } catch (error: unknown) {
      ctx.logger.warn(`qq-bot: could not ensure session: ${String(error)}`)
      sendText(message.scene, message.peerId, `⚠️ 处理失败：${String(error)}`)
      return
    }

    const content = await buildInboundContent(message, agent)
    if (content.length === 0) return
    if (resolved.ack !== '') sendText(message.scene, message.peerId, resolved.ack)
    try {
      agent.followup(createUserMessage({ content, source: { kind: 'user' } }))
    } catch (error: unknown) {
      ctx.logger.warn(`qq-bot: followup failed: ${String(error)}`)
      sendText(message.scene, message.peerId, `⚠️ 提交失败：${String(error)}`)
    }
  }

  const imageSupportCache = new Map<string, boolean>()

  /** Whether the agent's current model declares image input support. */
  async function supportsImageInput(agent: Agent): Promise<boolean> {
    const llm = ctx.get('llm') as LlmLike | undefined
    const provider = agent.options.provider
    const model = agent.options.model
    if (llm === undefined || provider === undefined || model === undefined) return false
    const cacheKey = `${provider}\u0000${model}`
    const cached = imageSupportCache.get(cacheKey)
    if (cached !== undefined) return cached
    let supported = false
    try {
      const info = await llm.resolveModelInfo(provider, model)
      supported = info.inputModalities?.includes('image') ?? false
    } catch (error: unknown) {
      ctx.logger.warn(`qq-bot: image-support lookup failed: ${String(error)}`)
    }
    imageSupportCache.set(cacheKey, supported)
    return supported
  }

  async function buildInboundContent(message: InboundMessage, agent: Agent): Promise<ContentBlock[]> {
    const blocks: ContentBlock[] = []
    if (message.content !== '') blocks.push({ type: 'text', text: message.content })

    const cwd = agent.session.header.cwd ?? process.cwd()
    for (const attachment of message.attachments) {
      const mediaType = normalizeMediaType(attachment.contentType)
      const isImage = attachment.kind === 'image' && mediaType !== undefined
      if (isImage && (hasVisionModel || await supportsImageInput(agent))) {
        try {
          const data = readFileSync(attachment.path)
          const refs = await ctx.attachments.saveImages([{
            data,
            mediaType,
            ...attachment.filename !== null && attachment.filename !== '' ? { name: attachment.filename } : {},
          }])
          const ref = refs[0]
          if (ref !== undefined) blocks.push({ type: 'image', attachment: ref })
        } catch (error: unknown) {
          ctx.logger.warn(`qq-bot: image admission failed: ${String(error)}`)
        }
      } else {
        // A file, or an image the current model cannot see: persist it into the
        // agent workspace and name the path so the agent's own fs tools can read it.
        const name = attachment.filename ?? basename(attachment.path)
        const dest = join(cwd, 'uploads', name)
        try {
          mkdirSync(join(cwd, 'uploads'), { recursive: true })
          copyFileSync(attachment.path, dest)
          const note = isImage
            ? `用户发来了一张图片「${name}」，已保存到工作目录 ${join('uploads', name)}（当前模型不支持直接查看图片）。`
            : `用户发来了文件「${name}」，已保存到工作目录 ${join('uploads', name)}。`
          blocks.push({ type: 'text', text: note })
        } catch (error: unknown) {
          ctx.logger.warn(`qq-bot: attachment copy failed: ${String(error)}`)
        }
      }
    }
    return blocks
  }

  ctx.on('session/event', (session, event: SessionEvent) => {
    const route = registry.ownerOf(session.header.id)
    if (route === undefined) return
    if (event.type !== 'assistant/message') return
    const previous = outputTails.get(session.header.id) ?? Promise.resolve()
    const delivery = previous.then(() => deliverAssistant(route, event.data.message.content))
    outputTails.set(session.header.id, delivery.catch((error: unknown) => {
      ctx.logger.warn(`qq-bot: assistant delivery failed: ${String(error)}`)
    }))
  })

  async function deliverAssistant(route: PeerRoute, blocks: readonly ContentBlock[]): Promise<void> {
    let text = ''
    for (const block of blocks) {
      if (block.type === 'text') {
        text += block.text
        continue
      }
      if (block.type === 'image') {
        if (text !== '') { sendText(route.scene, route.peerId, text); text = '' }
        await deliverImage(route, block)
        continue
      }
      // reasoning / tool-call / tool-result blocks are not user-facing.
    }
    if (text !== '') sendText(route.scene, route.peerId, text)
  }

  async function deliverImage(route: PeerRoute, block: Extract<ContentBlock, { type: 'image' }>): Promise<void> {
    try {
      const stored = await ctx.attachments.readImage(block.attachment)
      const ext = stored.ref.mediaType === 'image/png' ? '.png'
        : stored.ref.mediaType === 'image/webp' ? '.webp'
        : stored.ref.mediaType === 'image/gif' ? '.gif'
        : '.jpg'
      const path = join(resolved.mediaDir, `out-${randomUUID()}${ext}`)
      mkdirSync(resolved.mediaDir, { recursive: true })
      writeFileSync(path, stored.data)
      bridge.send({
        type: 'send', scene: route.scene, peerId: route.peerId,
        kind: 'image', payload: { path, mediaType: stored.ref.mediaType },
      })
    } catch (error: unknown) {
      ctx.logger.warn(`qq-bot: image read failed: ${String(error)}`)
      sendText(route.scene, route.peerId, '🖼️（图片读取失败）')
    }
  }

  bridge.start()

  ctx.effect(() => () => {
    void (async () => {
      await bridge.close()
      await registry.dispose()
    })()
  })
}
