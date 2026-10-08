/**
 * Plugin configuration and media-type normalization for the QQ bot bridge.
 * @module @deepseek-ai/dsh-qq-bot/config
 */

import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import z from '@deepseek-ai/schemastery'
import type { Volatile } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'

/** Declared plugin config; empty string means "use the default". 0.2.0 设置体系要求 volatile 字段才进 describe/UI，值为 Volatile 引用。 */
export interface Config {
  /** QQ 开放平台 AppID. */
  appid: Volatile<string>
  /** AppSecret inline. Prefer {@link secretEnv} to keep it out of the config file. */
  secret: Volatile<string>
  /** Environment variable that carries the AppSecret (wins over nothing; `secret` wins over it). */
  secretEnv: Volatile<string>
  /** Python interpreter used to run the bridge. */
  pythonPath: Volatile<string>
  /** Absolute path to `bot.py`; empty resolves the bundled `python/bot.py`. */
  botScript: Volatile<string>
  /** Durable state directory (peer → session map). Defaults to `$DSH_HOME/qq-bot`. */
  stateDir: Volatile<string>
  /** Shared media directory for inbound/outbound attachment bytes. */
  mediaDir: Volatile<string>
  /** Shared workspace directory for all QQ sessions; also registered as the sidebar workspace group. */
  cwdRoot: Volatile<string>
  /** Sidebar workspace group title the QQ sessions are grouped under. */
  workspaceTitle: Volatile<string>
  /** Provider route for created agents (empty = deployment default). */
  provider: Volatile<string>
  /** Model id for created agents (empty = deployment default). */
  model: Volatile<string>
  /** Provider route used when the message contains an image (empty = no vision routing). */
  visionProvider: Volatile<string>
  /** Vision-capable model id used when the message contains an image (empty = no vision routing). */
  visionModel: Volatile<string>
  /** Maximum output tokens per request (0 = unset). */
  maxTokens: Volatile<number>
  /** Send assistant text as QQ Markdown (`msg_type=2`) instead of plain text. Live reference. */
  markdown: Volatile<boolean>
  /** When non-empty, reply with this acknowledgement immediately on receipt. */
  ack: Volatile<string>
}

export const Config = z.object({
  appid: z.string().default('').description('QQ 开放平台 AppID（开放平台应用详情页获取）').volatile(),
  secret: z.string().default('').role('secret').description('AppSecret 明文（推荐用 secretEnv 走环境变量）').volatile(),
  secretEnv: z.string().default('').description('存 AppSecret 的环境变量名（如 QQBOT_SECRET）').volatile(),
  pythonPath: z.string().default('python').description('Python 解释器（跑桥接进程）').volatile(),
  botScript: z.string().default('').description('bot.py 路径（空 = 用内置脚本）').volatile(),
  stateDir: z.string().default('').description('状态目录（空 = /qq-bot）').volatile(),
  mediaDir: z.string().default('').description('媒体缓存目录（空 = 状态目录/media）').volatile(),
  cwdRoot: z.string().default('').description('会话工作区根目录（空 = 状态目录/workspaces）').volatile(),
  workspaceTitle: z.string().default('QQ bot').description('侧边栏工作区分组标题').volatile(),
  provider: z.string().default('').description('对话 LLM provider（空 = 部署默认模型）').volatile(),
  model: z.string().default('').description('对话模型 id（空 = 部署默认模型）').volatile(),
  visionProvider: z.string().default('').description('图片消息的 provider（空 = 不专门路由）').volatile(),
  visionModel: z.string().default('').description('图片消息的模型 id（空 = 不专门路由）').volatile(),
  maxTokens: z.number().default(0).description('单次请求输出上限 token（0 = 不限）').volatile(),
  markdown: z.boolean().default(true).description('回复以 QQ Markdown 格式发送（即时生效）').volatile(),
  ack: z.string().default('').description('收到消息的即时确认语（空 = 不确认）').volatile(),
})

/** Config with every default resolved to a concrete absolute path or value（Volatile 已解包为快照）. */
export interface ResolvedConfig {
  appid: string
  secret: string
  pythonPath: string
  botScript: string
  stateDir: string
  mediaDir: string
  cwdRoot: string
  workspaceTitle: string
  provider: string
  model: string
  visionProvider: string
  visionModel: string
  maxTokens: number
  markdown: boolean
  ack: string
}

/** Resolve defaults into absolute paths and materialize the effective secret. */
export function resolveConfig(config: Config): ResolvedConfig {
  // 0.2.0 volatile 引用解包为快照（写入触发宿主重挂载，apply 重跑即取到新值）
  const unwrap = <T,>(ref: Volatile<T>): T => ref.get() as T
  const c = {
    appid: unwrap(config.appid),
    secret: unwrap(config.secret),
    secretEnv: unwrap(config.secretEnv),
    pythonPath: unwrap(config.pythonPath),
    botScript: unwrap(config.botScript),
    stateDir: unwrap(config.stateDir),
    mediaDir: unwrap(config.mediaDir),
    cwdRoot: unwrap(config.cwdRoot),
    workspaceTitle: unwrap(config.workspaceTitle),
    provider: unwrap(config.provider),
    model: unwrap(config.model),
    visionProvider: unwrap(config.visionProvider),
    visionModel: unwrap(config.visionModel),
    maxTokens: unwrap(config.maxTokens),
    markdown: unwrap(config.markdown),
    ack: unwrap(config.ack),
  }
  const stateDir = resolve(c.stateDir !== '' ? c.stateDir : dshHomePath('qq-bot'))
  const mediaDir = resolve(c.mediaDir !== '' ? c.mediaDir : join(stateDir, 'media'))
  const cwdRoot = resolve(c.cwdRoot !== '' ? c.cwdRoot : join(stateDir, 'workspaces'))
  const botScript = c.botScript !== '' ? c.botScript : fileURLToPath(new URL('../python/bot.py', import.meta.url))
  const secret = c.secret !== ''
    ? c.secret
    : c.secretEnv !== '' ? process.env[c.secretEnv] ?? '' : ''
  return { ...c, secret, stateDir, mediaDir, cwdRoot, botScript }
}

/** Whether the bridge has enough configuration to start. */
export function isConfigured(config: ResolvedConfig): boolean {
  return config.appid !== '' && config.secret !== ''
}

const MEDIA_TYPES: Record<string, ImageMediaType> = {
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/webp': 'image/webp',
  'image/gif': 'image/gif',
}

/** Map a QQ attachment `content_type` to an attachment-service media type, if it is a raster image. */
export function normalizeMediaType(contentType: string): ImageMediaType | undefined {
  return MEDIA_TYPES[contentType.toLowerCase()]
}
