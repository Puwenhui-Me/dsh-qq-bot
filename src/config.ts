/**
 * Plugin configuration and media-type normalization for the QQ bot bridge.
 * @module @deepseek-ai/dsh-qq-bot/config
 */

import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'

/** Declared plugin config; empty string means "use the default". */
export interface Config {
  /** QQ 开放平台 AppID. */
  appid: string
  /** AppSecret inline. Prefer {@link secretEnv} to keep it out of the config file. */
  secret: string
  /** Environment variable that carries the AppSecret (wins over nothing; `secret` wins over it). */
  secretEnv: string
  /** Python interpreter used to run the bridge. */
  pythonPath: string
  /** Absolute path to `bot.py`; empty resolves the bundled `python/bot.py`. */
  botScript: string
  /** Durable state directory (peer → session map). Defaults to `$DSH_HOME/qq-bot`. */
  stateDir: string
  /** Shared media directory for inbound/outbound attachment bytes. */
  mediaDir: string
  /** Shared workspace directory for all QQ sessions; also registered as the sidebar workspace group. */
  cwdRoot: string
  /** Sidebar workspace group title the QQ sessions are grouped under. */
  workspaceTitle: string
  /** Provider route for created agents (empty = deployment default). */
  provider: string
  /** Model id for created agents (empty = deployment default). */
  model: string
  /** Provider route used when the message contains an image (empty = no vision routing). */
  visionProvider: string
  /** Vision-capable model id used when the message contains an image (empty = no vision routing). */
  visionModel: string
  /** Maximum output tokens per request (0 = unset). */
  maxTokens: number
  /** Send assistant text as QQ Markdown (`msg_type=2`) instead of plain text. */
  markdown: boolean
  /** When non-empty, reply with this acknowledgement immediately on receipt. */
  ack: string
}

export const Config: z<Config> = z.object({
  appid: z.string().default(''),
  secret: z.string().default(''),
  secretEnv: z.string().default(''),
  pythonPath: z.string().default('python'),
  botScript: z.string().default(''),
  stateDir: z.string().default(''),
  mediaDir: z.string().default(''),
  cwdRoot: z.string().default(''),
  workspaceTitle: z.string().default('QQ bot'),
  provider: z.string().default(''),
  model: z.string().default(''),
  visionProvider: z.string().default(''),
  visionModel: z.string().default(''),
  maxTokens: z.number().default(0),
  markdown: z.boolean().default(true),
  ack: z.string().default(''),
})

/** Config with every default resolved to a concrete absolute path or value. */
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
  const stateDir = resolve(config.stateDir !== '' ? config.stateDir : dshHomePath('qq-bot'))
  const mediaDir = resolve(config.mediaDir !== '' ? config.mediaDir : join(stateDir, 'media'))
  const cwdRoot = resolve(config.cwdRoot !== '' ? config.cwdRoot : join(stateDir, 'workspaces'))
  const botScript = config.botScript !== '' ? config.botScript : fileURLToPath(new URL('../python/bot.py', import.meta.url))
  const secret = config.secret !== ''
    ? config.secret
    : config.secretEnv !== '' ? process.env[config.secretEnv] ?? '' : ''
  return { ...config, secret, stateDir, mediaDir, cwdRoot, botScript }
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
