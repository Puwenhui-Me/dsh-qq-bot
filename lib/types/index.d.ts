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
import type { Context } from '@deepseek-ai/cordis';
import { Config } from './config.ts';
export declare const name = "qq-bot";
export declare const inject: string[];
export { Config };
export type { Config as QqBotConfig, ResolvedConfig } from './config.ts';
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map