import { Peer, DataConnection } from "peerjs"
import { isJDNMessage, isP2PControlMessage } from "./validation"

export type P2POptions = {
    isHost: boolean
    roomId: string
    onData?: (data: unknown, peerId: string) => void
}

// Internal P2P control message type guard (for ping/pong)
function isP2PMessage(
    data: unknown,
): data is { __type: string; t1: number; serverTime: number } {
    return isP2PControlMessage(data)
}

export class P2PClient {
    private peer: Peer | null = null
    private connections: Map<string, DataConnection> = new Map()
    private options: P2POptions
    private initialized = false
    public clockOffset = 0 // Local Time - Remote Time (Add this to Remote Time to get Local Time)

    constructor(options: P2POptions) {
        this.options = options
        this.init()
    }

    public async syncClock() {
        if (this.options.isHost) return
        const hostId = this.getPeerId()
        console.log("[P2P] Starting Clock Sync...")

        const t1 = Date.now()
        this.sendTo(hostId, { __type: "__ping", t1 })
    }

    private getPeerId(): string {
        return `odp-${this.options.roomId.toLowerCase()}`
    }

    private async init(retryCount = 0) {
        if (this.initialized) return

        let peerId: string | undefined

        if (this.options.isHost) {
            peerId = this.getPeerId()
            console.log(
                `[P2P] Initializing Host with ID: ${peerId} (Attempt ${retryCount + 1})`,
            )
        } else {
            console.log(`[P2P] Initializing Follower`)
            peerId = undefined
        }

        try {
            // @ts-ignore
            this.peer = new Peer(peerId, {
                debug: 1, // Reduced debug level
            })

            this.peer.on("open", (id: string) => {
                console.log(`[P2P] Connected to PeerServer with ID: ${id}`)
                this.initialized = true

                if (!this.options.isHost) {
                    this.connectToHost()
                }
            })

            this.peer.on("connection", (conn: DataConnection) => {
                console.log(`[P2P] Incoming connection from: ${conn.peer}`)
                this.handleConnection(conn, true)
            })

            this.peer.on("error", (err: unknown) => {
                console.error(`[P2P] Error:`, err)
                if (
                    err &&
                    typeof err === "object" &&
                    "type" in err &&
                    (err as { type: string }).type === "unavailable-id"
                ) {
                    if (this.options.isHost && retryCount < 3) {
                        console.warn(`[P2P] Room ID taken. Retrying in 2s...`)
                        setTimeout(() => this.init(retryCount + 1), 2000)
                        return
                    }
                    console.error(
                        "[P2P] Room ID is permanently unavailable. Is another host running?",
                    )
                }
            })
        } catch (e) {
            console.error("[P2P] Failed to create Peer instance:", e)
        }
    }

    private connectToHost(retryCount = 0) {
        if (!this.peer) return
        const hostId = this.getPeerId()
        console.log(`[P2P] Connecting to Host: ${hostId}`)

        const conn = this.peer.connect(hostId, {
            reliable: true,
        })

        // Simple connection timeout/retry
        const connectionTimeout = setTimeout(() => {
            if (!conn.open && retryCount < 5) {
                console.log("[P2P] Connection timed out, retrying...")
                conn.close()
                this.connectToHost(retryCount + 1)
            }
        }, 5000)

        conn.on("open", () => {
            clearTimeout(connectionTimeout)
        })

        this.handleConnection(conn, false)
    }

    private handleConnection(conn: DataConnection, isIncoming: boolean) {
        conn.on("open", () => {
            console.log(`[P2P] Connection opened with: ${conn.peer}`)
            this.connections.set(conn.peer, conn)

            if (isIncoming) {
                this.trigger("connection", conn.peer)
            } else {
                this.trigger("connect", conn.peer)
            }
        })

        conn.on("data", (data: unknown) => {
            if (
                isP2PMessage(data) &&
                data.__type === "__ping" &&
                this.options.isHost
            ) {
                // Host replies with server time
                conn.send({
                    __type: "__pong",
                    t1: data.t1,
                    serverTime: Date.now(),
                })
                return
            }
            if (
                isP2PMessage(data) &&
                data.__type === "__pong" &&
                !this.options.isHost
            ) {
                const t4 = Date.now()
                const t1 = data.t1
                const serverTime = data.serverTime

                const rtt = t4 - t1

                this.clockOffset = t4 - (serverTime + rtt / 2)
                console.log(
                    `[P2P] Sync Complete. RTT: ${rtt}ms, Clock Delta: ${this.clockOffset}ms`,
                )
                return
            }

            // Validate incoming data before dispatching
            // Accept: P2P control messages, JDN messages, or strings (ODP protocol)
            if (
                !isP2PMessage(data) &&
                !isJDNMessage(data) &&
                typeof data !== "string"
            ) {
                console.warn(
                    "[P2P] Received invalid data type, ignoring:",
                    typeof data,
                )
                return
            }

            if (this.options.onData) {
                this.options.onData(data, conn.peer)
            }
        })

        conn.on("close", () => {
            console.log(`[P2P] Connection closed: ${conn.peer}`)
            this.connections.delete(conn.peer)
            // If we are follower and lost host, maybe try to reconnect?
            if (!this.options.isHost && !isIncoming) {
                console.log(
                    "[P2P] Lost connection to Host. Attempting reconnect in 3s...",
                )
                setTimeout(() => this.connectToHost(), 3000)
            }
        })

        conn.on("error", (err: unknown) => {
            console.error(`[P2P] Connection error with ${conn.peer}:`, err)
            this.connections.delete(conn.peer)
        })
    }

    public broadcast(data: unknown) {
        if (this.connections.size === 0) return

        for (const [_peerId, conn] of this.connections) {
            if (conn.open) {
                conn.send(data)
            }
        }
    }

    public sendTo(peerId: string, data: unknown) {
        const conn = this.connections.get(peerId)
        if (conn && conn.open) {
            conn.send(data)
        }
    }
    public on(event: string, callback: (data?: unknown) => void) {
        if (event === "connect") {
            this.callbacks.connect.push(callback)
        } else if (event === "connection") {
            this.callbacks.connection.push(callback)
        }
    }

    public getPeerIds(): string[] {
        return Array.from(this.connections.keys())
    }

    private callbacks = {
        connect: [] as ((data?: unknown) => void)[],
        connection: [] as ((data?: unknown) => void)[],
    }

    private trigger(event: "connect" | "connection", data?: unknown) {
        // @ts-ignore
        this.callbacks[event].forEach((cb) => cb(data))
    }
}
