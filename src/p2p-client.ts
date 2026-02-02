import { Peer, DataConnection } from "peerjs"

export type P2POptions = {
    isHost: boolean
    roomId: string
    onData?: (data: unknown, peerId: string) => void
}

function isP2PMessage(data: unknown): data is { __type: string, t1: number, serverTime: number } {
    return typeof data === 'object' && data !== null && '__type' in data;
}

export class P2PClient {
    private peer: Peer | null = null
    private connections: Map<string, DataConnection> = new Map()
    private options: P2POptions
    private initialized = false
    public clockOffset = 0; // Local Time - Remote Time (Add this to Remote Time to get Local Time)

    constructor(options: P2POptions) {
        this.options = options
        this.init()
    }

    public async syncClock() {
        if (this.options.isHost) return;
        const hostId = this.getPeerId();
        console.log("[P2P] Starting Clock Sync...");

        // NTP-like handshake
        // T1: Client sends Ping
        // T2: Server receives Ping
        // T3: Server sends Pong
        // T4: Client receives Pong

        // Offset = ((T2 - T1) + (T3 - T4)) / 2
        // RTT = (T4 - T1) - (T3 - T2)

        // Simplified: We assume Server processes instantly, so T2 approx T3.
        // Offset = T_server - T_client - RTT/2

        const t1 = Date.now();
        this.sendTo(hostId, { __type: "__ping", t1 });
    }

    private getPeerId(): string {
        return `odp-${this.options.roomId.toLowerCase()}`
    }

    private async init(retryCount = 0) {
        if (this.initialized) return

        let peerId: string | undefined

        if (this.options.isHost) {
            peerId = this.getPeerId()
            console.log(`[P2P] Initializing Host with ID: ${peerId} (Attempt ${retryCount + 1})`)
        } else {
            console.log(`[P2P] Initializing Follower`)
            peerId = undefined;
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
                if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'unavailable-id') {
                    if (this.options.isHost && retryCount < 3) {
                        console.warn(`[P2P] Room ID taken. Retrying in 2s...`);
                        setTimeout(() => this.init(retryCount + 1), 2000);
                        return;
                    }
                    console.error('[P2P] Room ID is permanently unavailable. Is another host running?')
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
            reliable: true
        })

        // Simple connection timeout/retry
        const connectionTimeout = setTimeout(() => {
            if (!conn.open && retryCount < 5) {
                console.log("[P2P] Connection timed out, retrying...");
                conn.close();
                this.connectToHost(retryCount + 1);
            }
        }, 5000);

        conn.on("open", () => {
            clearTimeout(connectionTimeout);
        });

        this.handleConnection(conn, false)
    }

    private handleConnection(conn: DataConnection, isIncoming: boolean) {
        conn.on("open", () => {
            console.log(`[P2P] Connection opened with: ${conn.peer}`)
            this.connections.set(conn.peer, conn)

            if (isIncoming) {
                this.trigger('connection', conn.peer)
            } else {
                this.trigger('connect', conn.peer)
            }
        })

        conn.on("data", (data: unknown) => {
            if (isP2PMessage(data) && data.__type === "__ping" && this.options.isHost) {
                // Host replies with server time
                conn.send({ __type: "__pong", t1: data.t1, serverTime: Date.now() });
                return;
            }
            if (isP2PMessage(data) && data.__type === "__pong" && !this.options.isHost) {
                const t4 = Date.now();
                const t1 = data.t1;
                const serverTime = data.serverTime;

                const rtt = t4 - t1;
                // We estimate that the server sent the message at `serverTime`.
                // The message took `rtt / 2` to arrive.
                // So at T4 (now), the real server time is `serverTime + rtt/2`.
                // Offset = (serverTime + rtt/2) - T4 (Wait, we defined offset as Local - Remote?)
                // Let's stick to: We want to convert Remote -> Local.
                // Remote = serverTime
                // Local corresponding to serverTime is t1 + rtt/2? No.

                // Let's use simple delta:
                // at T4, Server is roughly `serverTime + rtt/2`.
                // Delta = T4 - (serverTime + rtt/2).
                // So: Local = Remote + Delta

                this.clockOffset = t4 - (serverTime + (rtt / 2));
                console.log(`[P2P] Sync Complete. RTT: ${rtt}ms, Clock Delta: ${this.clockOffset}ms`);
                return;
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
                console.log("[P2P] Lost connection to Host. Attempting reconnect in 3s...");
                setTimeout(() => this.connectToHost(), 3000);
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
        if (event === 'connect') {
            this.callbacks.connect.push(callback);
        } else if (event === 'connection') {
            this.callbacks.connection.push(callback);
        }
    }

    public getPeerIds(): string[] {
        return Array.from(this.connections.keys())
    }

    private callbacks = {
        connect: [] as ((data?: unknown) => void)[],
        connection: [] as ((data?: unknown) => void)[],
    }

    private trigger(event: 'connect' | 'connection', data?: unknown) {
        // @ts-ignore
        this.callbacks[event].forEach(cb => cb(data));
    }
}
