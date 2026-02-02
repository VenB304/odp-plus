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
                // client structure: { tag: "Follower", contents: "room-id" }
                // or { tag: "Host", contents: { ... } }

                if (client.tag === ODPClient.FollowerTag) {
                    // client.contents is { hostToFollow: string }
                    // We need to cast or access it dynamically
                    const contents = client.contents as any;
                    const roomId = contents.hostToFollow || contents; // Fallback if it was a string
                    console.log("[ODP] Follower initializing P2P for Room: " + roomId);
                    this.initP2P(false, roomId);
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
    private cachedRegisterRoomMsg: any = null;
    private playersCache: any[] = [];
    private currentSongState: {
        tabRest: any | null,
        navRest: any | null,
        selected: any | null,
        coachSelected: any | null,
        neverDanceAlone: any | null,
        launched: any | null,
        start: any | null
    } = { tabRest: null, navRest: null, selected: null, coachSelected: null, neverDanceAlone: null, launched: null, start: null };

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
                    // Update UI with Host Connected info
                    waitForElm(".danceroom__label").then((p) => {
                        if (!(p instanceof HTMLParagraphElement)) return;
                        const observer = new MutationObserver((_) => {
                            if (p.innerText != odpMsg.hostId) {
                                p.innerText = odpMsg.hostId;
                            }
                        });
                        observer.observe(p, { attributes: true, subtree: true, childList: true });
                        p.innerText = odpMsg.hostId; // Set immediately as well
                    });
                    return; // SWALLOW MESSAGE
                } else if (odpMsg instanceof SongStart) {
                    songStartSync(odpMsg.startTime);
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
            // Fix: PeerJS might send strings that aren't JDN JSON.
            let msg: any = null;
            try {
                msg = wsStringToObject(ev.data);
            } catch (e) {
                // Not a JDN object, ignore or handle differently
            }

            // We need to parse odpTag again to check role (or cache it)
            // For performance/cleanliness, we should cache the role.
            // But strict parsing here:
            let isHost = false;
            try {
                const client = JSON.parse(this.odpTag || '{}');
                isHost = client.tag === ODPClient.HostTag;
            } catch { }

            if (isHost) {
                if (msg) {
                    console.log("[ODP Debug] Received:", msg.func, msg); // Verbose logging
                    if (msg.func === "connect" || msg.roomNumber) {
                        console.log("[ODP] Potential Connection Msg:", msg);
                    }
                } else {
                    console.log("[ODP Debug] Received non-parsed data:", ev.data);
                }

                // Check for 'connect' (original expectation) OR 'registerRoom' (seen in logs)
                if ((msg.func === "connect" && msg.roomNumber) || (msg.func === "registerRoom" && msg.roomID)) {
                    this.cachedRegisterRoomMsg = msg; // Cache for new followers
                    const roomId = msg.roomNumber || msg.roomID;
                    console.log("[ODP] Host connected to Room: " + roomId);
                    this.initP2P(true, roomId.toString());
                }

                // Fallback: Sometimes roomNumber comes in other messages or differently named functions?
                // Just in case, if we see a roomNumber property, let's use it.
                if (msg && msg.roomNumber && !this.p2pInitialized) {
                    console.log("[ODP] Found roomNumber in msg (" + msg.func + "): " + msg.roomNumber);
                    this.initP2P(true, msg.roomNumber.toString());
                }

                // Track Players for Late Joiners
                if (msg.func === "playerJoined") {
                    this.playersCache.push(msg);
                } else if (msg.func === "playerLeft") {
                    // msg.playerID is the ID of left player
                    this.playersCache = this.playersCache.filter((p: any) => p.newPlayer.id !== msg.playerID);
                }

                // Track Song State for Late Joiners - Comprehensive Caching
                if (msg.func === "tabRest") {
                    this.currentSongState.tabRest = msg;
                    // Usually tabRest doesn't clear song selection, but looking at server logic...
                    // "List.take 1 st ++ [WSMsg]". tabRest is index 0.
                } else if (msg.func === "navRest") {
                    this.currentSongState.navRest = msg;
                    // Reset song specific states on navRest (returning to menu usually)
                    // But wait, navRest comes BEFORE songSelected.
                } else if (msg.func === "songSelected") {
                    this.currentSongState.selected = msg;
                } else if (msg.func === "coachSelected") {
                    this.currentSongState.coachSelected = msg;
                } else if (msg.func === "neverDanceAlone") {
                    this.currentSongState.neverDanceAlone = msg;
                } else if (msg.func === "songLaunched") {
                    this.currentSongState.launched = msg;
                } else if (msg.func === "songStart") {
                    this.currentSongState.start = msg;
                } else if (msg.func === "songEnd" || msg.func === "returnToLobby") {
                    // Reset on end or navigation to lobby/menus
                    // navRest usually implies going back to song list, but catch explicit resets
                    if (msg.func !== "songStart") { // songStart isn't an end
                        this.currentSongState = {
                            tabRest: this.currentSongState.tabRest,
                            navRest: this.currentSongState.navRest, // Keep navRest? maybe not.
                            selected: null,
                            coachSelected: null,
                            neverDanceAlone: null,
                            launched: null,
                            start: null
                        };
                    }
                }

                // Note: songStart usually comes from the HOST's send(), not onmessage()!
                // We need to capture it in send() too.

                // Broadcast ALL messages to Followers
                // This ensures navigation, pings, scores, emoji, everything is synced.
                if (this.p2pClient) {
                    // Filter out initializing peers from real-time broadcasts
                    // to prevent them from receiving gameplay events before they are ready.
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

    // Intercept OnClose to prevent Follower Reloads
    set onclose(f: ((this: WebSocket, ev: CloseEvent) => unknown) | null) {
        // @ts-ignore
        super.onclose = (ev: CloseEvent) => {
            console.log("[ODP] Real WebSocket Closed:", ev.code, ev.reason);

            if (this.odpTag) {
                try {
                    const client = JSON.parse(this.odpTag);
                    if (client.tag === ODPClient.FollowerTag) {
                        console.log("[ODP] Follower: Suppressing Close Event to prevent reload.");
                        return; // Swallow event
                    }
                } catch { }
            }
            if (f) {
                // @ts-ignore
                f.call(this, ev);
            }
        };
    }

    // Intercept OnError to prevent Follower Reloads
    set onerror(f: ((this: WebSocket, ev: Event) => unknown) | null) {
        // @ts-ignore
        super.onerror = (ev: Event) => {
            console.log("[ODP] Real WebSocket Error:", ev);

            if (this.odpTag) {
                try {
                    const client = JSON.parse(this.odpTag);
                    if (client.tag === ODPClient.FollowerTag) {
                        console.log("[ODP] Follower: Suppressing Error Event.");
                        return; // Swallow event
                    }
                } catch { }
            }
            if (f) {
                // @ts-ignore
                f.call(this, ev);
            }
        };
    }

    // Mock ReadyState to always be OPEN for Follower
    get readyState(): number {
        if (this.odpTag) {
            try {
                const client = JSON.parse(this.odpTag);
                if (client.tag === ODPClient.FollowerTag) {
                    return WebSocket.OPEN; // Always return 1 (OPEN)
                }
            } catch { }
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
            this.p2pClient.on('connection', (peerId: string) => {
                console.log("[ODP] New Peer Connected: " + peerId);
                if (this.cachedRegisterRoomMsg) {
                    console.log("[ODP] Sending handshake to new peer");

                    let delay = 0;
                    const peerIdCapture = peerId; // Capture for timeout scope

                    // 1. Clock Sync Simulation (Vital: Must be FIRST, before RegisterRoom)
                    const now = Date.now();
                    for (let i = 0; i < 5; i++) {
                        setTimeout(() => {
                            this.p2pClient?.sendTo(peerIdCapture, {
                                func: "sync",
                                sync: {
                                    o: now + (i * 100),
                                    r: 0,
                                    t: 0,
                                    d: 0
                                }
                            });
                        }, delay += 100);
                    }

                    setTimeout(() => {
                        this.p2pClient?.sendTo(peerIdCapture, {
                            func: "clientSyncCompleted",
                            latency: 50,
                            clockOffset: 0,
                            scoringWindowWidth: 1,
                            serverTime: Date.now()
                        });
                    }, delay += 100);

                    // 2. RegisterRoomResponse (Must arrive AFTER Sync)
                    setTimeout(() => {
                        console.log("[ODP] Sending cached registerRoomMsg");
                        this.p2pClient?.sendTo(peerIdCapture, this.cachedRegisterRoomMsg);
                    }, delay += 100);

                    // 3. Connected (ODP Message)
                    setTimeout(() => {
                        const roomId = this.cachedRegisterRoomMsg.roomID || this.cachedRegisterRoomMsg.roomNumber;
                        const odpConnectedMsg = {
                            tag: "Connected",
                            contents: {
                                hostId: roomId.toString()
                            }
                        };
                        this.p2pClient?.sendTo(peerIdCapture, "06BJ" + JSON.stringify(odpConnectedMsg));
                    }, delay += 100);

                    this.initializingPeers.add(peerId);

                    // 4. Players and State (After handshake)
                    setTimeout(() => {
                        // Sync existing players
                        this.playersCache.forEach((pMsg: any) => {
                            console.log("[ODP] Syncing player to new peer:", pMsg.newPlayer.nickname);
                            this.p2pClient?.sendTo(peerIdCapture, pMsg);
                        });

                        // Sync Cache Song State (Late Joiners) with Delays (Sequence)
                        let delay = 0;

                        // 1. Clock Sync Simulation (Vital for JDN Client Initialization)
                        const now = Date.now();
                        for (let i = 0; i < 5; i++) {
                            setTimeout(() => {
                                this.p2pClient?.sendTo(peerId, {
                                    func: "sync",
                                    sync: {
                                        o: now + (i * 100), // 'o' original timestamp
                                        r: 0,
                                        t: 0,
                                        d: 0
                                    }
                                });
                            }, delay += 100);
                        }

                        setTimeout(() => {
                            this.p2pClient?.sendTo(peerId, {
                                func: "clientSyncCompleted",
                                latency: 50,
                                clockOffset: 0,
                                scoringWindowWidth: 1,
                                serverTime: Date.now()
                            });
                        }, delay += 100);

                        // 2. Context / Menu selection
                        if (this.currentSongState.tabRest) {
                            setTimeout(() => {
                                console.log("[ODP] Syncing tabRest");
                                this.p2pClient?.sendTo(peerId, this.currentSongState.tabRest);
                            }, delay += 100);
                        }

                        if (this.currentSongState.navRest) {
                            setTimeout(() => {
                                console.log("[ODP] Syncing navRest");
                                this.p2pClient?.sendTo(peerId, this.currentSongState.navRest);
                            }, delay += 200);
                        }

                        // 2. Song Selection
                        if (this.currentSongState.selected) {
                            setTimeout(() => {
                                console.log("[ODP] Syncing Song Selected");
                                this.p2pClient?.sendTo(peerId, this.currentSongState.selected);
                            }, delay += 500);
                        }

                        // 3. Coach Selection (if any)
                        if (this.currentSongState.coachSelected) {
                            setTimeout(() => {
                                console.log("[ODP] Syncing Coach Selected");
                                this.p2pClient?.sendTo(peerId, this.currentSongState.coachSelected);
                            }, delay += 200); // little delay
                        }

                        // 4. Ghost Config (if any)
                        if (this.currentSongState.neverDanceAlone) {
                            setTimeout(() => {
                                console.log("[ODP] Syncing NeverDanceAlone");
                                this.p2pClient?.sendTo(peerId, this.currentSongState.neverDanceAlone);
                            }, delay += 200);
                        }

                        // 5. Song Launch (Video Load)
                        if (this.currentSongState.launched) {
                            setTimeout(() => {
                                console.log("[ODP] Syncing Song Launched");
                                this.p2pClient?.sendTo(peerId, this.currentSongState.launched);
                            }, delay += 2000); // Wait for load
                        }

                        // 6. Song Start (Gameplay)
                        if (this.currentSongState.start) {
                            setTimeout(() => {
                                console.log("[ODP] Syncing Song Start");
                                this.p2pClient?.sendTo(peerId, this.currentSongState.start);
                            }, delay += 4000); // Wait for video to be ready
                        }

                        // Clear initialization flag after all potential syncs
                        setTimeout(() => {
                            console.log("[ODP] Peer Initialization Complete: " + peerId);
                            this.initializingPeers.delete(peerId);
                        }, delay + 1000);

                    }, 100);
                }
            });
        }
    }

    private mockConnect(roomId: string) {
        console.log("[ODP] Injecting Mock Connection for Room: " + roomId);
        // This message trick the game into thinking it connected to the server
        const mockMsg = {
            func: "connect",
            status: 200,
            roomNumber: roomId,
            // Add other fields if JDN is picky (based on host logs previously seen)
        };
        this.handleP2PData(mockMsg, "internal-mock");
    }

    private handleP2PData(data: any, peerId: string) {
        console.log("[ODP] P2P Received:", data);

        // If we received data via P2P (as a follower), we need to act on it.
        // The original logic processed 'ev.data' (string) via onmessage.
        // We can simulate an event.

        // We need access to the 'f' (the original onmessage handler). 
        // But 'f' is stored in 'superOnMessage' inside the closure of the setter...
        // This is tricky.

        // Workaround: We can dispatch a bubbling event or call the handler if we stored it attached to 'this'.
        // But since we can't easily access the closure, let's try to invoke the onmessage handler directly if it's set on the object.

        // Actually, 'this.onmessage' refers to the wrapper. We need the original.
        // A better approach in the setter is to store 'f' in a property on 'this'.

        // Let's rely on the fact that we can reconstruct the event and call 'super.onmessage' if we could... but we can't.

        // Alternative: Trigger a message event on the socket itself?
        // this.dispatchEvent(new MessageEvent('message', { data: wsObjectToString(data) }));
        // This *should* trigger the onmessage handler if it was added via addEventListener or set via onmessage property.

        // Assuming the game uses .onmessage = ...

        const dataStr = wsObjectToString(data);
        const event = new MessageEvent('message', {
            data: dataStr,
            origin: "wss://p2p-simulation",
        });

        // We need to call the "internal" handler that the game set.
        // We can't access 'superOnMessage' from here.

        // REFACTOR: Store the game's handler in a public property when it's set.
        // See the updated setter below.

        if (this.gameOnMessage) {
            // @ts-ignore
            this.gameOnMessage(event);
        } else {
            console.warn("[ODP] NO MESSAGE HANDLER FOUND! Game client is ignoring P2P data.");
        }
    }

    send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
        if (typeof data === "string") {
            const msg = wsStringToObject(data) as any;

            let isHost = false;
            let isFollower = false;
            try {
                const client = JSON.parse(this.odpTag || '{}');
                isHost = client.tag === ODPClient.HostTag;
                isFollower = client.tag === ODPClient.FollowerTag;
            } catch { }

            // Capture Host sending SongStart
            if (isHost) {
                if (JDNProtocol.extractFunctionString(data) === "songStart") {
                    // We need to broadcast this to followers!
                    console.log("[ODP] Host Starting Song -> Broadcast P2P");
                    // Cache it for late joiners
                    this.currentSongState.start = msg;

                    if (this.p2pClient) {
                        // We might need to inject a timestamp here if JDN doesn't provide absolute time
                        this.p2pClient.broadcast(msg);
                    }
                }
            } else if (isFollower) {
                // Follower Logic:
                const func = JDNProtocol.extractFunctionString(data);

                // Critical: If Client sends Ping, we MUST Pong back, otherwise it thinks connection is dead and reloads.
                if (func === "ping") {
                    this.handleP2PData({ func: "pong" }, "internal-auto-pong");
                }

                // If we are strictly P2P, we might effectively be mocked socket entirely for Followers.
                return; // Don't send anything to real JDN as follower
            }
        }
        // Only Host connects to real JDN

        let shouldConnect = true;
        try {
            // Basic check if we are strictly follower
            const client = JSON.parse(this.odpTag || '{}');
            if (client.tag === ODPClient.FollowerTag) shouldConnect = false;
        } catch { }

        if (shouldConnect) {
            return super.send(data)
        }
    }
}
