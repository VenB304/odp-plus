import { Peer, DataConnection } from "peerjs"

export type P2POptions = {
    isHost: boolean
    roomId: string
    onData?: (data: unknown, peerId: string) => void
}

export class P2PClient {
    private peer: Peer | null = null
    private connections: Map<string, DataConnection> = new Map()
    private options: P2POptions
    private initialized = false

    constructor(options: P2POptions) {
        this.options = options
        this.init()
    }

    private getPeerId(): string {
        return `odp-${this.options.roomId.toLowerCase()}`
    }

    private async init() {
        if (this.initialized) return

        let peerId: string | undefined

        if (this.options.isHost) {
            peerId = this.getPeerId()
            console.log(`[P2P] Initializing Host with ID: ${peerId}`)
        } else {
            console.log(`[P2P] Initializing Follower`)
            // Follower uses undefined (random ID)
            peerId = undefined;
        }

        try {
            // @ts-ignore
            this.peer = new Peer(peerId, {
                debug: 2,
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

            this.peer.on("error", (err: any) => {
                console.error(`[P2P] Error:`, err)
                if (err.type === 'unavailable-id') {
                    console.error('[P2P] Room ID is taken. Is a host already running?')
                }
            })

        } catch (e) {
            console.error("[P2P] Failed to create Peer instance:", e)
        }
    }

    private connectToHost() {
        if (!this.peer) return
        const hostId = this.getPeerId()
        console.log(`[P2P] Connecting to Host: ${hostId}`)

        const conn = this.peer.connect(hostId, {
            reliable: true
        })
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
            // console.log(`[P2P] Received data from ${conn.peer}:`, data)
            if (this.options.onData) {
                this.options.onData(data, conn.peer)
            }
        })

        conn.on("close", () => {
            console.log(`[P2P] Connection closed: ${conn.peer}`)
            this.connections.delete(conn.peer)
        })

        conn.on("error", (err: any) => {
            console.error(`[P2P] Connection error with ${conn.peer}:`, err)
            this.connections.delete(conn.peer)
        })
    }

    public broadcast(data: unknown) {
        if (this.connections.size === 0) return

        for (const [peerId, conn] of this.connections) {
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
    public on(event: string, callback: (data?: any) => void) {
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
        connect: [] as ((data?: any) => void)[],
        connection: [] as ((data?: any) => void)[],
    }

    private trigger(event: 'connect' | 'connection', data?: any) {
        // @ts-ignore
        this.callbacks[event].forEach(cb => cb(data));
    }
}
