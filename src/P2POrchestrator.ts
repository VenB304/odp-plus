import { P2PClient } from "./p2p-client"
import { GameStateManager, JDNMessage } from "./model/GameStateManager"
import { getJDNRegion } from "./utils"

export interface OrchestratorConfig {
    getWebSocketUrl: () => string
    onP2PData: (data: unknown, peerId: string) => void
}

/**
 * P2POrchestrator handles all P2P connection lifecycle management,
 * game state tracking, and message broadcasting.
 * This separates P2P orchestration from WebSocket proxying.
 */
export class P2POrchestrator {
    private p2pClient: P2PClient | null = null
    private p2pInitialized = false
    private gameState = new GameStateManager()
    private initializingPeers = new Set<string>()
    private peersWaitingForSong = new Set<string>()
    private cachedRegisterRoomMsg: JDNMessage | null = null
    private pendingRTTProbes = new Map<string, (t1: number) => void>()
    private config: OrchestratorConfig
    private readyPeers: Set<string> = new Set()
    private finishedPeers: Set<string> = new Set()
    private hostVideoReady: boolean = false
    private songStartResolver: (() => void) | null = null
    private resultsSyncResolver: (() => void) | null = null
    private syncTimeout: ReturnType<typeof setTimeout> | null = null

    constructor(config: OrchestratorConfig) {
        this.config = config
    }

    public get isMidSong(): boolean {
        return this.gameState.isMidSong
    }

    public get clockOffset(): number {
        return this.p2pClient?.clockOffset ?? 0
    }

    /**
     * Initialize P2P connection as host or follower.
     */
    public initialize(isHost: boolean, roomId: string): void {
        if (this.p2pInitialized) return
        this.p2pInitialized = true

        console.log(
            `[ODP] P2POrchestrator initializing as ${isHost ? "Host" : "Follower"} for room: ${roomId}`,
        )

        this.p2pClient = new P2PClient({
            isHost,
            roomId,
            onData: (data, peerId) => {
                this.config.onP2PData(data, peerId)
            },
        })

        if (isHost) {
            this.p2pClient.on("connection", (peerIdWithUnknown: unknown) => {
                this.handleNewPeerConnection(peerIdWithUnknown as string)
            })
        }
    }

    /**
     * Trigger clock sync for followers.
     */
    public syncClock(): void {
        this.p2pClient?.syncClock()
    }

    /**
     * Start periodic clock re-sync for followers to prevent drift.
     */
    public startPeriodicSync(): void {
        this.p2pClient?.startPeriodicSync()
    }

    /**
     * Handle incoming JDN message for state tracking.
     */
    public handleMessage(msg: JDNMessage): void {
        // Track registration message for replay
        if (
            (msg.func === "connect" && msg.roomNumber) ||
            (msg.func === "registerRoom" && msg.roomID)
        ) {
            this.cachedRegisterRoomMsg = msg
        }

        // Game state tracking
        this.gameState.handleMessage(msg)

        // Clear waiting peers when song ends
        if (msg.func === "songEnd" || msg.func === "returnToLobby") {
            this.peersWaitingForSong.clear()
        }
    }

    /**
     * Broadcast a message to all connected peers.
     */
    public broadcastMessage(msg: JDNMessage): void {
        if (!this.p2pClient) return

        const gameplayFuncs = ["playerFeedBack", "playerScore", "playerMoves"]
        const isGameplayMsg = gameplayFuncs.includes(msg.func)

        const allPeers = this.p2pClient.getPeerIds()
        for (const peerId of allPeers) {
            // Skip if still initializing
            if (this.initializingPeers.has(peerId)) continue
            // Skip gameplay messages for late joiners
            if (isGameplayMsg && this.peersWaitingForSong.has(peerId)) continue

            this.p2pClient.sendTo(peerId, msg)
        }
    }

    /**
     * Broadcast raw data (for ODP protocol messages like SongStart).
     */
    public broadcastRaw(data: unknown): void {
        this.p2pClient?.broadcast(data)
    }

    /**
     * Forward a message to the host (follower only).
     * The host will relay it to the JDN server so the game can
     * receive scoring, pictogram, and other gameplay responses.
     */
    public forwardToHost(data: unknown): void {
        if (!this.p2pClient) return
        const peerIds = this.p2pClient.getPeerIds()
        if (peerIds.length > 0) {
            this.p2pClient.sendTo(peerIds[0], {
                __type: "__forward",
                payload: data,
            })
        }
    }

    /**
     * Check if P2P is initialized.
     */
    public get isInitialized(): boolean {
        return this.p2pInitialized
    }

    /**
     * Handle RTT echo response from a peer during handshake.
     * Called from the P2P data handler when __rttEcho is received.
     */
    public handleRTTEcho(
        data: { __type: string; t1: number },
        peerId: string,
    ): void {
        const handler = this.pendingRTTProbes.get(peerId)
        if (handler) {
            handler(data.t1)
        }
    }

    // --- Sync Gate API ---

    /**
     * Reset all sync-gate state at the start of a new song.
     */
    public resetSyncGates(): void {
        this.readyPeers.clear()
        this.finishedPeers.clear()
        this.hostVideoReady = false
        this.songStartResolver = null
        this.resultsSyncResolver = null
        if (this.syncTimeout) clearTimeout(this.syncTimeout)
    }

    /**
     * Mark the host's own video as ready to play.
     */
    public markHostVideoReady(): void {
        this.hostVideoReady = true
        this.checkStartReadiness()
    }

    /**
     * Record that a follower's video is buffered and ready.
     */
    public handleReadyToStart(peerId: string): void {
        const peerIds = this.p2pClient?.getPeerIds() ?? []
        if (peerIds.includes(peerId)) {
            this.readyPeers.add(peerId)
            this.checkStartReadiness()
        }
    }

    /**
     * Record that a follower's video has finished playing.
     */
    public handleReadyForResults(peerId: string): void {
        const peerIds = this.p2pClient?.getPeerIds() ?? []
        if (peerIds.includes(peerId)) {
            this.finishedPeers.add(peerId)
            this.checkResultsReadiness()
        }
    }

    /**
     * Returns a promise that resolves once the host video AND
     * every connected follower have signalled readiness
     * (or the timeout fires).
     */
    public async waitForAllReady(timeoutMs: number = 15000): Promise<void> {
        const activePeers = this.p2pClient?.getPeerIds() ?? []
        if (activePeers.length === 0 && this.hostVideoReady) {
            return
        }

        return new Promise<void>((resolve) => {
            this.songStartResolver = resolve
            this.syncTimeout = setTimeout(() => {
                console.log("[P2P] Start sync timeout — starting anyway")
                this.resolveStartSync()
            }, timeoutMs)
            this.checkStartReadiness()
        })
    }

    /**
     * Returns a promise that resolves once every connected follower
     * has signalled that their video has ended (or the timeout fires).
     */
    public async waitForAllFinished(timeoutMs: number = 15000): Promise<void> {
        const activePeers = this.p2pClient?.getPeerIds() ?? []
        if (activePeers.length === 0) return

        return new Promise<void>((resolve) => {
            this.resultsSyncResolver = resolve
            this.syncTimeout = setTimeout(() => {
                console.log(
                    "[P2P] Results sync timeout — showing results anyway",
                )
                this.resolveResultsSync()
            }, timeoutMs)
            this.checkResultsReadiness()
        })
    }

    private checkStartReadiness(): void {
        const activePeers = this.p2pClient?.getPeerIds() ?? []
        const allPeersReady = activePeers.every((id) => this.readyPeers.has(id))

        if (
            this.hostVideoReady &&
            (activePeers.length === 0 || allPeersReady)
        ) {
            this.resolveStartSync()
        }
    }

    private checkResultsReadiness(): void {
        const activePeers = this.p2pClient?.getPeerIds() ?? []
        const allPeersFinished = activePeers.every((id) =>
            this.finishedPeers.has(id),
        )

        if (activePeers.length === 0 || allPeersFinished) {
            this.resolveResultsSync()
        }
    }

    private resolveStartSync(): void {
        if (this.syncTimeout) clearTimeout(this.syncTimeout)
        if (this.songStartResolver) {
            this.songStartResolver()
            this.songStartResolver = null
        }
    }

    private resolveResultsSync(): void {
        if (this.syncTimeout) clearTimeout(this.syncTimeout)
        if (this.resultsSyncResolver) {
            this.resultsSyncResolver()
            this.resultsSyncResolver = null
        }
    }

    /**
     * Check if a peer is still connected before sending.
     * Used by the handshake sequence to abort if peer disconnected.
     */
    private isPeerAlive(peerId: string): boolean {
        return this.p2pClient?.isPeerConnected(peerId) ?? false
    }

    /**
     * Send data to a peer, but only if still connected.
     * Returns false if the peer has disconnected.
     */
    private safeSendTo(peerId: string, data: unknown): boolean {
        if (!this.isPeerAlive(peerId)) {
            console.warn(
                `[ODP] Peer ${peerId} disconnected, aborting handshake send`,
            )
            this.initializingPeers.delete(peerId)
            return false
        }
        this.p2pClient?.sendTo(peerId, data)
        return true
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms))
    }

    /**
     * Measure RTT to a peer by sending an __rttProbe and waiting for
     * the __rttEcho response. Falls back to 100ms on timeout.
     */
    private measurePeerRTT(peerId: string): Promise<number> {
        return new Promise<number>((resolve) => {
            const t1 = Date.now()
            const timeout = setTimeout(() => {
                this.pendingRTTProbes.delete(peerId)
                console.warn("[ODP] RTT probe timed out, using fallback 100ms")
                resolve(100)
            }, 2000)

            this.pendingRTTProbes.set(peerId, (echoT1: number) => {
                clearTimeout(timeout)
                this.pendingRTTProbes.delete(peerId)
                resolve(Date.now() - echoT1)
            })

            this.p2pClient?.sendTo(peerId, { __type: "__rttProbe", t1 })
        })
    }

    /**
     * Handle new peer connection (host only).
     * Measures actual RTT to the peer for accurate sync calibration
     * and replays game state for late joiners.
     */
    private async handleNewPeerConnection(peerId: string): Promise<void> {
        console.log("[ODP] New Peer Connected: " + peerId)

        if (!this.cachedRegisterRoomMsg) {
            console.warn("[ODP] No cached room message for handshake")
            return
        }

        console.log("[ODP] Starting handshake sequence for peer: " + peerId)
        this.initializingPeers.add(peerId)

        // 0. Stabilization delay — let RTCDataChannel fully settle
        await this.sleep(500)
        if (!this.isPeerAlive(peerId)) {
            this.initializingPeers.delete(peerId)
            return
        }

        // 1. Measure actual RTT to peer for sync calibration
        const measuredRTT = await this.measurePeerRTT(peerId)
        const latency = Math.round(measuredRTT / 2)
        console.log(
            `[ODP] Measured RTT to ${peerId}: ${measuredRTT}ms (latency: ${latency}ms)`,
        )

        // 2. JDN Sync Pings
        const now = Date.now()
        for (let i = 0; i < 5; i++) {
            await this.sleep(100)
            if (
                !this.safeSendTo(peerId, {
                    func: "sync",
                    sync: { o: now + i * 100, r: 0, t: 0, d: 0 },
                })
            )
                return
        }

        // 3. Sync Complete — use measured latency instead of hardcoded value
        await this.sleep(100)
        if (
            !this.safeSendTo(peerId, {
                func: "clientSyncCompleted",
                latency: latency,
                clockOffset: 0,
                scoringWindowWidth: 1,
                serverTime: Date.now(),
            })
        )
            return

        // 4. RegisterRoom
        await this.sleep(100)
        if (this.cachedRegisterRoomMsg) {
            if (!this.safeSendTo(peerId, this.cachedRegisterRoomMsg)) return
        }

        // 5. Connected (ODP message)
        await this.sleep(100)
        if (this.cachedRegisterRoomMsg) {
            const roomId =
                this.cachedRegisterRoomMsg.roomID ||
                this.cachedRegisterRoomMsg.roomNumber
            const wsUrl = this.config.getWebSocketUrl()
            if (
                !this.safeSendTo(
                    peerId,
                    "06BJ" +
                        JSON.stringify({
                            tag: "Connected",
                            contents: {
                                hostId: roomId.toString(),
                                region: getJDNRegion(wsUrl).regionCode,
                            },
                        }),
                )
            )
                return
        }

        // 6. Replay Game State
        await this.sleep(400)
        if (!this.isPeerAlive(peerId)) {
            console.warn(`[ODP] Peer ${peerId} disconnected before replay`)
            this.initializingPeers.delete(peerId)
            return
        }

        const replayMsgs = this.gameState.getReplayMessages()
        console.log(
            `[ODP] Replaying ${replayMsgs.length} state messages to ${peerId}`,
        )

        if (this.gameState.isMidSong) {
            console.log(
                `[ODP] Peer ${peerId} joined mid-song, will wait for song to end`,
            )
            this.peersWaitingForSong.add(peerId)
        }

        for (const msg of replayMsgs) {
            await this.sleep(200)
            this.safeSendTo(peerId, msg)
        }

        await this.sleep(1000)
        console.log("[ODP] Peer Initialization Complete: " + peerId)
        this.initializingPeers.delete(peerId)
    }
}
