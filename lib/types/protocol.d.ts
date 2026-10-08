/**
 * NDJSON wire protocol between the qq-bot plugin and its Python botpy
 * subprocess. One JSON object per line; stdout carries QQ → DSH events, stdin
 * carries DSH → QQ send instructions. Media payloads reference local filesystem
 * paths (Python downloads QQ attachments before forwarding; DSH writes outbound
 * images to the shared media directory), never inline bytes.
 * @module @deepseek-ai/dsh-qq-bot/protocol
 */
/** One attachment forwarded from a QQ message. `path` is already on disk. */
export interface InboundAttachment {
    kind: 'image' | 'file';
    contentType: string;
    filename: string | null;
    path: string;
}
/** A QQ C2C message the Python bridge handed to DSH. */
export interface InboundMessage {
    type: 'message';
    scene: 'c2c';
    peerId: string;
    msgId: string | null;
    content: string;
    attachments: InboundAttachment[];
}
/** Every event the Python bridge can emit on stdout. */
export type InboundEvent = InboundMessage | {
    type: 'ready';
} | {
    type: 'error';
    message: string;
};
/** Sendable content kinds; `markdown` maps to QQ `msg_type=2`. */
export type OutboundKind = 'text' | 'markdown' | 'image' | 'file';
/** Optional media fields carried by an outbound `send`. */
export interface OutboundPayload {
    text?: string;
    path?: string;
    filename?: string;
    mediaType?: string;
    url?: string;
}
/** A DSH → Python send instruction. */
export interface OutboundSend {
    type: 'send';
    scene: 'c2c';
    peerId: string;
    /** QQ message id to passively reply to, when present. */
    replyTo?: string;
    kind: OutboundKind;
    payload: OutboundPayload;
}
/** Incremental NDJSON line framer: turns raw stream chunks into complete lines. */
export declare class LineDecoder {
    private buffer;
    push(chunk: string): string[];
}
/** Encode one outbound object as a single NDJSON line. */
export declare function encode(event: unknown): string;
//# sourceMappingURL=protocol.d.ts.map