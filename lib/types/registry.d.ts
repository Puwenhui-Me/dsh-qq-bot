/**
 * Peer → agent/session registry. Each QQ peer owns one long-lived agent, and
 * the peer → session-id map is persisted so a restart resumes the same session
 * (multi-turn memory survives the process boundary). Agents are created lazily
 * on first message, which sidesteps the agent-factory startup race.
 *
 * All QQ sessions share one workspace directory (the plugin `cwdRoot`), which
 * is registered as a sidebar workspace group (`workspaceTitle`) when the
 * workspace service is available, so QQ conversations group together in the UI.
 * @module @deepseek-ai/dsh-qq-bot/registry
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent, AgentOptions, ModelSelection } from '@deepseek-ai/dsh-agent';
/** Routing info for one owned session. */
export interface PeerRoute {
    key: string;
    scene: 'c2c';
    peerId: string;
}
export declare class PeerRegistry {
    private readonly ctx;
    private readonly cwdRoot;
    private readonly agentOptions;
    private readonly workspaceTitle;
    private readonly visionSelection;
    private readonly live;
    private readonly sessions;
    private readonly routeBySession;
    private readonly mapPath;
    private readonly textSelection;
    private workspacePromise;
    constructor(ctx: Context, stateDir: string, cwdRoot: string, agentOptions: AgentOptions, workspaceTitle: string, visionSelection: ModelSelection | undefined);
    /** Stable registry key for one scene + peer. */
    static key(scene: string, peerId: string): string;
    /** Return the live agent for `key`, resuming or creating its session as needed. */
    ensure(key: string, peerId: string): Promise<Agent>;
    /** Resolve the peer routing for a session owned by this registry, if any. */
    ownerOf(sessionId: string): PeerRoute | undefined;
    /** Lazily register (or reuse) the shared sidebar workspace group. */
    private resolveWorkspace;
    /** Attach a session to the shared workspace group (best effort). */
    private attach;
    private tryResume;
    /**
     * Join the deployment's default agent preset so the agent gets the same
     * tools, prompt sections, and skill catalog as a web "New Session". A
     * rosterless deployment (no preset service) leaves the agent reading the
     * host plane, matching the headless entry point.
     */
    private setupAgent;
    private load;
    private persist;
    dispose(): Promise<void>;
}
//# sourceMappingURL=registry.d.ts.map