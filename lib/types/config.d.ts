/**
 * Plugin configuration and media-type normalization for the QQ bot bridge.
 * @module @deepseek-ai/dsh-qq-bot/config
 */
import z from '@deepseek-ai/schemastery';
import type { Volatile } from '@deepseek-ai/cordis';
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment';
/** Declared plugin config; empty string means "use the default". 0.2.0 设置体系要求 volatile 字段才进 describe/UI，值为 Volatile 引用。 */
export interface Config {
    /** QQ 开放平台 AppID. */
    appid: Volatile<string>;
    /** AppSecret inline. Prefer {@link secretEnv} to keep it out of the config file. */
    secret: Volatile<string>;
    /** Environment variable that carries the AppSecret (wins over nothing; `secret` wins over it). */
    secretEnv: Volatile<string>;
    /** Python interpreter used to run the bridge. */
    pythonPath: Volatile<string>;
    /** Absolute path to `bot.py`; empty resolves the bundled `python/bot.py`. */
    botScript: Volatile<string>;
    /** Durable state directory (peer → session map). Defaults to `$DSH_HOME/qq-bot`. */
    stateDir: Volatile<string>;
    /** Shared media directory for inbound/outbound attachment bytes. */
    mediaDir: Volatile<string>;
    /** Shared workspace directory for all QQ sessions; also registered as the sidebar workspace group. */
    cwdRoot: Volatile<string>;
    /** Sidebar workspace group title the QQ sessions are grouped under. */
    workspaceTitle: Volatile<string>;
    /** Provider route for created agents (empty = deployment default). */
    provider: Volatile<string>;
    /** Model id for created agents (empty = deployment default). */
    model: Volatile<string>;
    /** Provider route used when the message contains an image (empty = no vision routing). */
    visionProvider: Volatile<string>;
    /** Vision-capable model id used when the message contains an image (empty = no vision routing). */
    visionModel: Volatile<string>;
    /** Maximum output tokens per request (0 = unset). */
    maxTokens: Volatile<number>;
    /** Send assistant text as QQ Markdown (`msg_type=2`) instead of plain text. Live reference. */
    markdown: Volatile<boolean>;
    /** When non-empty, reply with this acknowledgement immediately on receipt. */
    ack: Volatile<string>;
}
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    appid: z<string, string, "volatile-defined">;
    secret: z<string, string, "volatile-defined">;
    secretEnv: z<string, string, "volatile-defined">;
    pythonPath: z<string, string, "volatile-defined">;
    botScript: z<string, string, "volatile-defined">;
    stateDir: z<string, string, "volatile-defined">;
    mediaDir: z<string, string, "volatile-defined">;
    cwdRoot: z<string, string, "volatile-defined">;
    workspaceTitle: z<string, string, "volatile-defined">;
    provider: z<string, string, "volatile-defined">;
    model: z<string, string, "volatile-defined">;
    visionProvider: z<string, string, "volatile-defined">;
    visionModel: z<string, string, "volatile-defined">;
    maxTokens: z<number, number, "volatile-defined">;
    markdown: z<boolean, boolean, "volatile-defined">;
    ack: z<string, string, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    appid: z<string, string, "volatile-defined">;
    secret: z<string, string, "volatile-defined">;
    secretEnv: z<string, string, "volatile-defined">;
    pythonPath: z<string, string, "volatile-defined">;
    botScript: z<string, string, "volatile-defined">;
    stateDir: z<string, string, "volatile-defined">;
    mediaDir: z<string, string, "volatile-defined">;
    cwdRoot: z<string, string, "volatile-defined">;
    workspaceTitle: z<string, string, "volatile-defined">;
    provider: z<string, string, "volatile-defined">;
    model: z<string, string, "volatile-defined">;
    visionProvider: z<string, string, "volatile-defined">;
    visionModel: z<string, string, "volatile-defined">;
    maxTokens: z<number, number, "volatile-defined">;
    markdown: z<boolean, boolean, "volatile-defined">;
    ack: z<string, string, "volatile-defined">;
}>>, "plain">;
/** Config with every default resolved to a concrete absolute path or value（Volatile 已解包为快照）. */
export interface ResolvedConfig {
    appid: string;
    secret: string;
    pythonPath: string;
    botScript: string;
    stateDir: string;
    mediaDir: string;
    cwdRoot: string;
    workspaceTitle: string;
    provider: string;
    model: string;
    visionProvider: string;
    visionModel: string;
    maxTokens: number;
    markdown: boolean;
    ack: string;
}
/** Resolve defaults into absolute paths and materialize the effective secret. */
export declare function resolveConfig(config: Config): ResolvedConfig;
/** Whether the bridge has enough configuration to start. */
export declare function isConfigured(config: ResolvedConfig): boolean;
/** Map a QQ attachment `content_type` to an attachment-service media type, if it is a raster image. */
export declare function normalizeMediaType(contentType: string): ImageMediaType | undefined;
//# sourceMappingURL=config.d.ts.map