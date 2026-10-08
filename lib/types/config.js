/**
 * Plugin configuration and media-type normalization for the QQ bot bridge.
 * @module @deepseek-ai/dsh-qq-bot/config
 */
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import z from '@deepseek-ai/schemastery';
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
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
});
/** Resolve defaults into absolute paths and materialize the effective secret. */
export function resolveConfig(config) {
    // 0.2.0 volatile 引用解包为快照（写入触发宿主重挂载，apply 重跑即取到新值）
    const unwrap = (ref) => ref.get();
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
    };
    const stateDir = resolve(c.stateDir !== '' ? c.stateDir : dshHomePath('qq-bot'));
    const mediaDir = resolve(c.mediaDir !== '' ? c.mediaDir : join(stateDir, 'media'));
    const cwdRoot = resolve(c.cwdRoot !== '' ? c.cwdRoot : join(stateDir, 'workspaces'));
    const botScript = c.botScript !== '' ? c.botScript : fileURLToPath(new URL('../python/bot.py', import.meta.url));
    const secret = c.secret !== ''
        ? c.secret
        : c.secretEnv !== '' ? process.env[c.secretEnv] ?? '' : '';
    return { ...c, secret, stateDir, mediaDir, cwdRoot, botScript };
}
/** Whether the bridge has enough configuration to start. */
export function isConfigured(config) {
    return config.appid !== '' && config.secret !== '';
}
const MEDIA_TYPES = {
    'image/png': 'image/png',
    'image/jpeg': 'image/jpeg',
    'image/jpg': 'image/jpeg',
    'image/webp': 'image/webp',
    'image/gif': 'image/gif',
};
/** Map a QQ attachment `content_type` to an attachment-service media type, if it is a raster image. */
export function normalizeMediaType(contentType) {
    return MEDIA_TYPES[contentType.toLowerCase()];
}
//# sourceMappingURL=config.js.map