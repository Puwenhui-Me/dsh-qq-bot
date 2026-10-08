/**
 * Spawns and supervises the Python botpy subprocess over NDJSON stdio.
 * stderr is inherited (botpy logs stay visible), while stdout is reserved
 * strictly for the NDJSON event stream. Exits are restarted with backoff; a
 * `ready` event resets the backoff.
 * @module @deepseek-ai/dsh-qq-bot/bridge
 */
import type { Context } from '@deepseek-ai/cordis';
import { type InboundEvent } from './protocol.ts';
import type { ResolvedConfig } from './config.ts';
export declare class Bridge {
    private readonly ctx;
    private readonly config;
    private readonly onEvent;
    private child;
    private readonly decoder;
    private restartDelay;
    private readonly restartMax;
    private restartTimer;
    private closed;
    constructor(ctx: Context, config: ResolvedConfig, onEvent: (event: InboundEvent) => void);
    start(): void;
    private spawn;
    /** The bridge reported `ready`: reset the restart backoff. */
    markReady(): void;
    send(message: unknown): void;
    close(): Promise<void>;
}
//# sourceMappingURL=bridge.d.ts.map