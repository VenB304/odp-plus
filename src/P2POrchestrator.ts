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
    private config: OrchestratorConfig

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

    /**
     * Handle new peer connection (host only).
     * Adds an initial stabilization delay to let the RTCDataChannel
     * fully open before sending handshake messages.
     */
    private handleNewPeerConnection(peerId: string): void {
        console.log("[ODP] New Peer Connected: " + peerId)

        if (!this.cachedRegisterRoomMsg) {
            console.warn("[ODP] No cached room message for handshake")
            return
        }

        console.log("[ODP] Starting handshake sequence for peer: " + peerId)
        this.initializingPeers.add(peerId)

        // Initial stabilization delay — let RTCDataChannel fully settle
        // before sending any data. Prevents "readyState is not open" errors
        // on high-latency connections.
        let delay = 500

        // 1. Clock Sync (5 pings)
        const now = Date.now()
        for (let i = 0; i < 5; i++) {
            setTimeout(
                () => {
                    this.safeSendTo(peerId, {
                        func: "sync",
                        sync: {
                            o: now + i * 100,
                            r: 0,
                            t: 0,
                            d: 0,
                        },
                    })
                },
                (delay += 100),
            )
        }

        // 2. Sync Complete
        setTimeout(
            () => {
                this.safeSendTo(peerId, {
                    func: "clientSyncCompleted",
                    latency: 50,
                    clockOffset: 0,
                    scoringWindowWidth: 1,
                    serverTime: Date.now(),
                })
            },
            (delay += 100),
        )

        // 3. RegisterRoom
        setTimeout(
            () => {
                if (this.cachedRegisterRoomMsg) {
                    this.safeSendTo(peerId, this.cachedRegisterRoomMsg)
                }
            },
            (delay += 100),
        )

        // 4. Connected (ODP message)
        setTimeout(
            () => {
                if (this.cachedRegisterRoomMsg) {
                    const roomId =
                        this.cachedRegisterRoomMsg.roomID ||
                        this.cachedRegisterRoomMsg.roomNumber
                    const wsUrl = this.config.getWebSocketUrl()
                    this.safeSendTo(
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
                }
            },
            (delay += 100),
        )

        // 5. Replay Game State
        setTimeout(() => {
            if (!this.isPeerAlive(peerId)) {
                console.warn(`[ODP] Peer ${peerId} disconnected before replay`)
                this.initializingPeers.delete(peerId)
                return
            }

            const replayMsgs = this.gameState.getReplayMessages()
            console.log(
                `[ODP] Replaying ${replayMsgs.length} state messages to ${peerId}`,
            )

            // Track late joiners
            if (this.gameState.isMidSong) {
                console.log(
                    `[ODP] Peer ${peerId} joined mid-song, will wait for song to end`,
                )
                this.peersWaitingForSong.add(peerId)
            }

            let replayDelay = 0
            for (const msg of replayMsgs) {
                setTimeout(
                    () => {
                        this.safeSendTo(peerId, msg)
                    },
                    (replayDelay += 200),
                )
            }

            // Mark initialization complete
            setTimeout(() => {
                console.log("[ODP] Peer Initialization Complete: " + peerId)
                this.initializingPeers.delete(peerId)
            }, replayDelay + 1000)
        }, delay + 400)
    }
}
