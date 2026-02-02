import { wsObjectToString, wsStringToObject } from "./jdn-protocol"
import * as JDNProtocol from "./jdn-protocol"
import { sleep } from "./utils"
import {
    Connected,
    ServerMsg,
    parseODPMsg,
    SongStart,
    UnknownMsg,
} from "./odp-msg"
import { ODPClient } from "./model/ODPClient"
import { waitForElm } from "./wait-for-elem"
import { P2PClient } from "./p2p-client"
import { GameStateManager, JDNMessage } from "./model/GameStateManager"

function correctVideoTime(hostStartTime: number) {
    // @ts-ignore
    const video = $("#in-game_video")[0]
    const currentPosition = video.currentTime * 1000
    const hostVideoTime = Date.now() - hostStartTime
    video.currentTime = hostVideoTime / 1000
    console.log(
        `ODP Set video to position ${hostVideoTime} from ${currentPosition}`,
    )
}

async function songStartSync(hostStartTime: number) {
    try {
        const waitStartTime = Date.now()
        // @ts-ignore
        while (!globalThis.jd.video.started) {
            if (Date.now() >= waitStartTime + 10 * 1000) {
                return
            }
            console.log("ODP Waiting for video to load")
            await sleep(100)
        }
        const currentVideoTime = Date.now() - hostStartTime
        if (currentVideoTime < 0) {
            console.log(`ODP Waiting ${-currentVideoTime} ms for start of song`)
            await sleep(-currentVideoTime)
        }
        correctVideoTime(hostStartTime)
        // Correct again in case it needed to buffer after the correction
        await sleep(1000)
        correctVideoTime(hostStartTime)
    } catch (e) {
        console.log("ODP Error while changing video position: ", e)
    }
}

export class OdpWebSocket extends WebSocket {
    private p2pClient: P2PClient | null = null
    private p2pInitialized = false
    private gameState = new GameStateManager();

    constructor(
        url: string | URL,
        protocols: string | string[],
        private odpTag: string | null,
    ) {
        super(url, protocols)

        // Initialize P2P for Follower immediately
        if (this.odpTag != null) {
            try {
                const client = JSON.parse(this.odpTag);
                if (client.tag === ODPClient.FollowerTag) {
                    const contents = client.contents as { hostToFollow?: string } | string;
                    const roomId = typeof contents === 'string' ? contents : contents.hostToFollow || "";
                    console.log("[ODP] Follower initializing P2P for Room: " + roomId);
                    this.initP2P(false, roomId);

                    // Trigger Clock Sync shortly after init (or when connected)
                    setTimeout(() => {
                        this.p2pClient?.syncClock();
                    }, 2000); // Give time for connection
                } else if (client.tag === ODPClient.HostTag) {
                    console.log("[ODP] Host initializing (waiting for JDN connect)");
                }
            } catch (e) {
                console.error("[ODP] Failed to parse odpTag:", e);
            }
        }
    }

    private hasSendFirstMessage = false
    private hostSongAlreadyStarted = false
    private cachedRegisterRoomMsg: JDNMessage | null = null;

    private initializingPeers = new Set<string>();

    // Store the game's handler
    private gameOnMessage: ((this: WebSocket, ev: MessageEvent) => unknown) | null = null;

    // We need to intercept the 'onmessage' setter to inject our logic
    set onmessage(f: ((this: WebSocket, ev: MessageEvent) => unknown) | null) {
        this.gameOnMessage = f; // Store the original handler

        // Custom onmessage handler that wraps the original one
        const newOnmessage = (ev: MessageEvent) => {
            // 1. ODP Message Interception (Prevent these from reaching the Game Client)
            if (this.odpTag != null && typeof ev.data === "string" && ev.data.startsWith("06BJ")) {
                const odpMsg = parseODPMsg(ev.data);
                if (odpMsg instanceof UnknownMsg) {
                    console.log(`[ODP] Error parsing ODP message: ${odpMsg.error}`);
                    return;
                } else if (odpMsg instanceof Connected) {
                    waitForElm(".danceroom__label").then((p) => {
                        if (!(p instanceof HTMLParagraphElement)) return;
                        const observer = new MutationObserver((_) => {
                            if (p.innerText != odpMsg.hostId) {
                                p.innerText = odpMsg.hostId;
                            }
                        });
                        observer.observe(p, { attributes: true, subtree: true, childList: true });
                        p.innerText = odpMsg.hostId;
                    });
                    return; // SWALLOW MESSAGE
                } else if (odpMsg instanceof SongStart) {
                    let adjustedTime = odpMsg.startTime;
                    if (this.p2pClient) {
                        // odpMsg.startTime is in Host Time.
                        // We want Local Time.
                        // Local = Host + Offset
                        // Wait, my offset calculation was Local - Remote.
                        // offset = T4 - (Server + RTT/2) = Local - Remote.
                        // So Local = Remote + Offset.
                        // Correct.
                        adjustedTime += this.p2pClient.clockOffset;
                        console.log(`[ODP] Sync: Adjusting Host Time ${odpMsg.startTime} by ${this.p2pClient.clockOffset}ms -> ${adjustedTime}`);
                    }
                    songStartSync(adjustedTime);
                    return; // SWALLOW MESSAGE
                } else if (odpMsg instanceof ServerMsg) {
                    // @ts-ignore
                    if (globalThis.jd && globalThis.jd.popUp) {
                        // @ts-ignore
                        globalThis.jd.popUp.build({
                            title: odpMsg.title,
                            content: odpMsg.content,
                            isError: odpMsg.isError,
                            timer: odpMsg.timer,
                            hideCancelation: odpMsg.hideCancellation,
                        });
                    }
                    return; // SWALLOW MESSAGE
                }
            }

            // Logic to capture Room ID from JDN messages (for Host)
            let msg: JDNMessage | null = null;
            try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                msg = wsStringToObject(ev.data) as any;
            } catch (e) {
                // Not a JDN object
            }

            // We need to parse odpTag again to check role (or cache it)
            // For performance/cleanliness, we should cache the role.
            // But strict parsing here:
            let isHost = false;
            try {
                const client = JSON.parse(this.odpTag || '{}');
                isHost = client.tag === ODPClient.HostTag;
            } catch {
                // ignore
            }

            if (isHost && msg) {
                // Connection Logic
                if ((msg.func === "connect" && msg.roomNumber) || (msg.func === "registerRoom" && msg.roomID)) {
                    this.cachedRegisterRoomMsg = msg;
                    const roomId = msg.roomNumber || msg.roomID;
                    console.log("[ODP] Host connected to Room: " + roomId);
                    this.initP2P(true, roomId.toString());
                } else if (msg.roomNumber && !this.p2pInitialized) {
                    // Fallback
                    console.log("[ODP] Found roomNumber in msg (" + msg.func + "): " + msg.roomNumber);
                    this.initP2P(true, msg.roomNumber.toString());
                }

                // Game State Tracking
                this.gameState.handleMessage(msg);

                // Broadcast ALL messages to Followers
                if (this.p2pClient) {
                    const allPeers = this.p2pClient.getPeerIds();
                    allPeers.forEach(peerId => {
                        if (!this.initializingPeers.has(peerId)) {
                            this.p2pClient?.sendTo(peerId, msg);
                        }
                    });
                }
            }

            if (this.gameOnMessage) {
                // @ts-ignore
                return this.gameOnMessage.call(this, ev);
            }
        };

        // @ts-ignore
        super.onmessage = newOnmessage;
    }

    set onclose(f: ((this: WebSocket, ev: CloseEvent) => unknown) | null) {
        // @ts-ignore
        super.onclose = (ev: CloseEvent) => {
            console.log("[ODP] Real WebSocket Closed:", ev.code, ev.reason);
            if (this.odpTag) {
                try {
                    const client = JSON.parse(this.odpTag);
                    if (client.tag === ODPClient.FollowerTag) {
                        return; // Swallow event
                    }
                } catch { /* intentionally empty */ }
            }
            if (f) {
                // @ts-ignore
                f.call(this, ev);
            }
        };
    }

    set onerror(f: ((this: WebSocket, ev: Event) => unknown) | null) {
        // @ts-ignore
        super.onerror = (ev: Event) => {
            console.log("[ODP] Real WebSocket Error:", ev);
            if (this.odpTag) {
                try {
                    const client = JSON.parse(this.odpTag);
                    if (client.tag === ODPClient.FollowerTag) {
                        return; // Swallow event
                    }
                } catch { /* intentionally empty */ }
            }
            if (f) {
                // @ts-ignore
                f.call(this, ev);
            }
        };
    }

    get readyState(): number {
        if (this.odpTag) {
            try {
                const client = JSON.parse(this.odpTag);
                if (client.tag === ODPClient.FollowerTag) {
                    return WebSocket.OPEN;
                }
            } catch { /* intentionally empty */ }
        }
        return super.readyState;
    }

    private initP2P(isHost: boolean, roomId: string) {
        if (this.p2pInitialized) return;
        this.p2pInitialized = true;

        this.p2pClient = new P2PClient({
            isHost,
            roomId,
            onData: (data, peerId) => {
                this.handleP2PData(data, peerId);
            }
        });

        if (isHost) {
            this.p2pClient.on('connection', (peerIdWithUnknown: unknown) => {
                const peerId = peerIdWithUnknown as string;
                console.log("[ODP] New Peer Connected: " + peerId);
                if (this.cachedRegisterRoomMsg) {
                    console.log("[ODP] Sending handshake to new peer");
                    let delay = 0;
                    const peerIdCapture = peerId;

                    // 1. Clock Sync
                    const now = Date.now();
                    for (let i = 0; i < 5; i++) {
                        setTimeout(() => {
                            this.p2pClient?.sendTo(peerIdCapture, { func: "sync", sync: { o: now + (i * 100), r: 0, t: 0, d: 0 } });
                        }, delay += 100);
                    }

                    setTimeout(() => {
                        this.p2pClient?.sendTo(peerIdCapture, { func: "clientSyncCompleted", latency: 50, clockOffset: 0, scoringWindowWidth: 1, serverTime: Date.now() });
                    }, delay += 100);

                    // 2. RegisterRoom
                    setTimeout(() => {
                        const regMsg = this.cachedRegisterRoomMsg;
                        if (regMsg) {
                            this.p2pClient?.sendTo(peerIdCapture, regMsg);
                        }
                    }, delay += 100);

                    // 3. Connected
                    setTimeout(() => {
                        const regMsg = this.cachedRegisterRoomMsg;
                        if (regMsg) {
                            const roomId = regMsg.roomID || regMsg.roomNumber;
                            this.p2pClient?.sendTo(peerIdCapture, "06BJ" + JSON.stringify({ tag: "Connected", contents: { hostId: roomId.toString() } }));
                        }
                    }, delay += 100);

                    this.initializingPeers.add(peerId);

                    // 4. Replay Game State
                    setTimeout(() => {
                        const replayMsgs = this.gameState.getReplayMessages();
                        console.log(`[ODP] Replaying ${replayMsgs.length} state messages to ${peerId}`);

                        let replayDelay = 0;
                        replayMsgs.forEach(msg => {
                            setTimeout(() => {
                                this.p2pClient?.sendTo(peerIdCapture, msg);
                            }, replayDelay += 200);
                        });

                        setTimeout(() => {
                            console.log("[ODP] Peer Initialization Complete: " + peerId);
                            this.initializingPeers.delete(peerId);
                        }, replayDelay + 1000);

                    }, delay + 400); // Wait for handshake to settle
                }
            });
        }
    }

    private handleP2PData(data: unknown, _peerId: string) {
        // console.log("[ODP] P2P Received:", data); // Verbose
        const dataStr = wsObjectToString(data);
        const event = new MessageEvent('message', {
            data: dataStr,
            origin: "wss://p2p-simulation",
        });

        if (this.gameOnMessage) {
            // @ts-ignore
            this.gameOnMessage(event);
        } else {
            console.warn("[ODP] NO MESSAGE HANDLER FOUND!");
        }
    }

    send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
        if (typeof data === "string") {
            const msg = wsStringToObject(data) as JDNMessage;
            let isHost = false;
            let isFollower = false;
            try {
                const client = JSON.parse(this.odpTag || '{}');
                isHost = client.tag === ODPClient.HostTag;
                isFollower = client.tag === ODPClient.FollowerTag;
            } catch { /* intentionally empty */ }

            if (isHost && msg) {
                if (JDNProtocol.extractFunctionString(data) === "songStart") {
                    console.log("[ODP] Host Starting Song -> Broadcast P2P");
                    this.gameState.handleMessage(msg); // Track start in state manager
                    if (this.p2pClient) {
                        this.p2pClient.broadcast(msg);
                    }
                }
            } else if (isFollower) {
                const func = JDNProtocol.extractFunctionString(data);
                if (func === "ping") {
                    this.handleP2PData({ func: "pong" }, "internal-auto-pong");
                }
                return;
            }
        }

        let shouldConnect = true;
        try {
            const client = JSON.parse(this.odpTag || '{}');
            if (client.tag === ODPClient.FollowerTag) shouldConnect = false;
        } catch { /* intentionally empty */ }

        if (shouldConnect) {
            return super.send(data)
        }
    }
}
