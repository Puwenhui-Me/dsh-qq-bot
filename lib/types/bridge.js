/**
 * Spawns and supervises the Python botpy subprocess over NDJSON stdio.
 * stderr is inherited (botpy logs stay visible), while stdout is reserved
 * strictly for the NDJSON event stream. Exits are restarted with backoff; a
 * `ready` event resets the backoff.
 * @module @deepseek-ai/dsh-qq-bot/bridge
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { encode, LineDecoder } from "./protocol.js";
export class Bridge {
    ctx;
    config;
    onEvent;
    child;
    decoder = new LineDecoder();
    restartDelay = 500;
    restartMax = 30_000;
    restartTimer;
    closed = false;
    constructor(ctx, config, onEvent) {
        this.ctx = ctx;
        this.config = config;
        this.onEvent = onEvent;
    }
    start() {
        this.spawn();
    }
    spawn() {
        mkdirSync(this.config.mediaDir, { recursive: true });
        const child = spawn(this.config.pythonPath, [this.config.botScript], {
            env: {
                ...process.env,
                PYTHONUTF8: '1',
                QQBOT_APPID: this.config.appid,
                QQBOT_SECRET: this.config.secret,
                QQBOT_MEDIA_DIR: this.config.mediaDir,
            },
            stdio: ['pipe', 'pipe', 'inherit'],
        });
        this.child = child;
        child.stdout?.setEncoding('utf8');
        child.stdout?.on('data', (chunk) => {
            for (const line of this.decoder.push(chunk)) {
                let event;
                try {
                    event = JSON.parse(line);
                }
                catch (error) {
                    this.ctx.logger.warn(`qq-bot: non-JSON bridge line: ${String(error)}`);
                    continue;
                }
                this.onEvent(event);
            }
        });
        child.on('error', (error) => {
            this.ctx.logger.warn(`qq-bot: bridge spawn failed: ${error.message}`);
        });
        child.on('exit', (code) => {
            if (this.child !== child)
                return;
            this.child = undefined;
            if (this.closed)
                return;
            this.ctx.logger.warn(`qq-bot: python bridge exited (${code ?? 'signal'}), restarting in ${this.restartDelay}ms`);
            this.restartTimer = setTimeout(() => this.spawn(), this.restartDelay);
            this.restartDelay = Math.min(this.restartDelay * 2, this.restartMax);
        });
    }
    /** The bridge reported `ready`: reset the restart backoff. */
    markReady() {
        this.restartDelay = 500;
    }
    send(message) {
        this.child?.stdin?.write(encode(message));
    }
    async close() {
        this.closed = true;
        if (this.restartTimer !== undefined)
            clearTimeout(this.restartTimer);
        const child = this.child;
        this.child = undefined;
        if (child === undefined)
            return;
        child.stdin?.end();
        child.kill();
        await new Promise((resolvePromise) => {
            child.once('exit', () => resolvePromise());
        });
    }
}
//# sourceMappingURL=bridge.js.map