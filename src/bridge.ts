/**
 * Spawns and supervises the Python botpy subprocess over NDJSON stdio.
 * stderr is inherited (botpy logs stay visible), while stdout is reserved
 * strictly for the NDJSON event stream. Exits are restarted with backoff; a
 * `ready` event resets the backoff.
 * @module @deepseek-ai/dsh-qq-bot/bridge
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import { encode, LineDecoder, type InboundEvent } from './protocol.ts'
import type { ResolvedConfig } from './config.ts'

export class Bridge {
  private child: ChildProcess | undefined
  private readonly decoder = new LineDecoder()
  private restartDelay = 500
  private readonly restartMax = 30_000
  private restartTimer: ReturnType<typeof setTimeout> | undefined
  private closed = false

  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedConfig,
    private readonly onEvent: (event: InboundEvent) => void,
  ) {}

  start(): void {
    this.spawn()
  }

  private spawn(): void {
    mkdirSync(this.config.mediaDir, { recursive: true })
    const child = spawn(this.config.pythonPath, [this.config.botScript], {
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        QQBOT_APPID: this.config.appid,
        QQBOT_SECRET: this.config.secret,
        QQBOT_MEDIA_DIR: this.config.mediaDir,
      },
      stdio: ['pipe', 'pipe', 'inherit'],
    })
    this.child = child

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      for (const line of this.decoder.push(chunk)) {
        let event: InboundEvent
        try {
          event = JSON.parse(line) as InboundEvent
        } catch (error: unknown) {
          this.ctx.logger.warn(`qq-bot: non-JSON bridge line: ${String(error)}`)
          continue
        }
        this.onEvent(event)
      }
    })

    child.on('error', (error: Error) => {
      this.ctx.logger.warn(`qq-bot: bridge spawn failed: ${error.message}`)
    })

    child.on('exit', (code) => {
      if (this.child !== child) return
      this.child = undefined
      if (this.closed) return
      this.ctx.logger.warn(`qq-bot: python bridge exited (${code ?? 'signal'}), restarting in ${this.restartDelay}ms`)
      this.restartTimer = setTimeout(() => this.spawn(), this.restartDelay)
      this.restartDelay = Math.min(this.restartDelay * 2, this.restartMax)
    })
  }

  /** The bridge reported `ready`: reset the restart backoff. */
  markReady(): void {
    this.restartDelay = 500
  }

  send(message: unknown): void {
    this.child?.stdin?.write(encode(message))
  }

  async close(): Promise<void> {
    this.closed = true
    if (this.restartTimer !== undefined) clearTimeout(this.restartTimer)
    const child = this.child
    this.child = undefined
    if (child === undefined) return
    child.stdin?.end()
    child.kill()
    await new Promise<void>((resolvePromise) => {
      child.once('exit', () => resolvePromise())
    })
  }
}
