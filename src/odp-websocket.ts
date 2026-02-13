import { wsObjectToString, wsStringToObject } from "./jdn-protocol"
import { getJDNRegion } from "./utils"
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
import { JDNMessage } from "./model/GameStateManager"
import { P2POrchestrator } from "./P2POrchestrator"
import { safeJsonParse } from "./validation"

function findVideoElement(): HTMLVideoElement | null {
    // @ts-ignore - accessing JDN game global (justdancenow.com)
    const jdnVideo = $("#in-game_video")[0] as HTMLVideoElement | undefined
    if (jdnVideo) return jdnVideo

    // Fallback for justdancenowplus.ru and other sites
    return document.querySelector("video")
}

function correctVideoTime(hostStartTime: number) {
    const video = findVideoElement()
    if (!video) {
        console.warn("[ODP] No video element found for sync")
        return
    }
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

        // Wait for video to be ready.
        // justdancenow.com uses jd.video.started; justdancenowplus.ru does not,
        // so we also check for a video element that is actually playing.
        while (true) {
            if (Date.now() >= waitStartTime + 15 * 1000) {
                console.warn("[ODP] Timed out waiting for video to start")
                return
            }

            // JDN: game global flag
            // @ts-ignore - accessing JDN game global
            if (globalThis.jd?.video?.started) break

            // JDNP fallback: video element exists, has data, and is playing
            const vid = findVideoElement()
            if (vid && vid.readyState >= 2 && !vid.paused) {
                console.log("[ODP] Video detected via element (JDNP fallback)")
                break
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

interface ParsedODPTag {
    tag: string
    contents: { hostToFollow?: string } | string
}

export class OdpWebSocket extends WebSocket {
    private orchestrator: P2POrchestrator | null = null
    private cachedTag: ParsedODPTag | null = null
    private isHost = false
    private isFollower = false

    // Store the game's handler
    private gameOnMessage:
        | ((this: WebSocket, ev: MessageEvent) => unknown)
        | null = null

    // Deferral queue: holds results/songEnd events for followers
    // when video is still playing
    private deferredMessages: MessageEvent[] = []
    private deferralTimer: ReturnType<typeof setTimeout> | null = null
    private videoEndWatcher: ReturnType<typeof setInterval> | null = null

    constructor(
        url: string | URL,
        protocols: string | string[],
        private odpTag: string | null,
    ) {
        super(url, protocols)

        // Parse and cache the ODP tag
        if (this.odpTag) {
            this.cachedTag = safeJsonParse<ParsedODPTag>(this.odpTag)
            if (this.cachedTag) {
                this.isHost = this.cachedTag.tag === ODPClient.HostTag
                this.isFollower = this.cachedTag.tag === ODPClient.FollowerTag
            }
        }

        // Initialize orchestrator
        if (this.cachedTag) {
            this.orchestrator = new P2POrchestrator({
                getWebSocketUrl: () => this.url,
                onP2PData: (data, peerId) => this.handleP2PData(data, peerId),
            })

            // Initialize P2P for Follower immediately
            if (this.isFollower) {
                const contents = this.cachedTag.contents
                const roomId =
                    typeof contents === "string"
                        ? contents
                        : contents.hostToFollow || ""
                console.log(
                    "[ODP] Follower initializing P2P for Room: " + roomId,
                )
                this.orchestrator.initialize(false, roomId)

                // Trigger Clock Sync shortly after init, then start periodic re-sync
                setTimeout(() => {
                    this.orchestrator?.syncClock()
                    this.orchestrator?.startPeriodicSync()
                }, 2000)
            } else if (this.isHost) {
                console.log("[ODP] Host initializing (waiting for JDN connect)")
            }
        }
    }

    // Intercept onmessage setter to inject our logic
    set onmessage(f: ((this: WebSocket, ev: MessageEvent) => unknown) | null) {
        this.gameOnMessage = f

        const newOnmessage = (ev: MessageEvent) => {
            // 1. ODP Message Interception
            if (
                this.cachedTag != null &&
                typeof ev.data === "string" &&
                ev.data.startsWith("06BJ")
            ) {
                const odpMsg = parseODPMsg(ev.data)
                if (odpMsg instanceof UnknownMsg) {
                    console.log(
                        `[ODP] Error parsing ODP message: ${odpMsg.error}`,
                    )
                    return
                } else if (odpMsg instanceof Connected) {
                    this.handleConnectedMessage(odpMsg)
                    return // SWALLOW MESSAGE
                } else if (odpMsg instanceof SongStart) {
                    this.handleSongStartMessage(odpMsg)
                    return // SWALLOW MESSAGE
                } else if (odpMsg instanceof ServerMsg) {
                    this.handleServerMessage(odpMsg)
                    return // SWALLOW MESSAGE
                }
            }

            // 2. Parse JDN message for state tracking
            let msg: JDNMessage | null = null
            if (typeof ev.data === "string" && !ev.data.startsWith("06BJ")) {
                try {
                    msg = wsStringToObject(ev.data) as JDNMessage
                } catch {
                    // Not a JDN object
                }
            }

            // 2.3. Follower deferral: if results/songEnd arrives while
            // the video is actively playing, queue and deliver later.
            if (this.isFollower && msg) {
                const endFuncs = ["results", "songEnd"]
                if (endFuncs.includes(msg.func)) {
                    const video = findVideoElement()
                    if (
                        video &&
                        !video.paused &&
                        !video.ended &&
                        video.readyState >= 2
                    ) {
                        console.log(
                            `[ODP] Deferring ${msg.func} — video still playing`,
                        )
                        this.deferredMessages.push(ev)
                        this.startDeferralWatcher()
                        return
                    }
                }
            }

            // 2.5. Clean up stale UI between songs
            if (msg) {
                this.cleanupBetweenSongs(msg)
            }

            // 3. Host-specific logic
            if (this.isHost && msg) {
                this.handleHostMessage(msg)
            }

            // 4. Call original game handler
            if (this.gameOnMessage) {
                // @ts-ignore - calling with correct this context
                return this.gameOnMessage.call(this, ev)
            }
        }

        // @ts-ignore - setting inherited property
        super.onmessage = newOnmessage
    }

    set onclose(f: ((this: WebSocket, ev: CloseEvent) => unknown) | null) {
        // @ts-ignore - setting inherited property
        super.onclose = (ev: CloseEvent) => {
            console.log("[ODP] Real WebSocket Closed:", ev.code, ev.reason)
            // Swallow close for Followers (they use P2P)
            if (this.isFollower) return
            if (f) {
                // @ts-ignore - calling with correct this context
                f.call(this, ev)
            }
        }
    }

    set onerror(f: ((this: WebSocket, ev: Event) => unknown) | null) {
        // @ts-ignore - setting inherited property
        super.onerror = (ev: Event) => {
            console.log("[ODP] Real WebSocket Error:", ev)
            // Swallow error for Followers (they use P2P)
            if (this.isFollower) return
            if (f) {
                // @ts-ignore - calling with correct this context
                f.call(this, ev)
            }
        }
    }

    get readyState(): number {
        // Followers always appear connected (using P2P)
        if (this.isFollower) return WebSocket.OPEN
        return super.readyState
    }

    send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
        if (typeof data === "string") {
            const func = JDNProtocol.extractFunctionString(data)

            if (this.isHost && func === "songStart") {
                console.log("[ODP] Host Starting Song -> Broadcast P2P")
                try {
                    const msg = wsStringToObject(data) as JDNMessage
                    this.orchestrator?.handleMessage(msg)
                    this.orchestrator?.broadcastRaw(msg)

                    // Broadcast SongStart ODP message with timestamp
                    // so followers can do clock-offset-corrected video sync
                    this.orchestrator?.broadcastRaw(
                        "06BJ" +
                            JSON.stringify({
                                tag: "SongStart",
                                contents: { startTime: Date.now() },
                            }),
                    )
                } catch {
                    // Continue with send
                }
            } else if (this.isFollower) {
                // Handle follower-specific messages
                if (func === "ping") {
                    this.handleP2PData({ func: "pong" }, "internal-auto-pong")
                    return
                }
                // Forward gameplay-related messages to host for server relay.
                // Skip connection/room messages to avoid duplicate registrations.
                const skipFuncs = ["connect", "registerRoom", "ping", "pong"]
                if (!skipFuncs.includes(func)) {
                    this.orchestrator?.forwardToHost(data)
                }
                return // Don't send to real WebSocket
            }
        }

        // Only host sends to real WebSocket
        if (!this.isFollower) {
            return super.send(data)
        }
    }

    // --- Deferral Logic ---

    /**
     * Start watching for the video to finish so we can flush
     * deferred results/songEnd messages. Also sets a 30-second
     * safety timeout to avoid leaving the follower stuck forever.
     */
    private startDeferralWatcher(): void {
        // Already watching
        if (this.videoEndWatcher) return

        // Safety timeout — always flush after 30s no matter what
        this.deferralTimer = setTimeout(() => {
            console.log(
                "[ODP] Deferral safety timeout (30s) — flushing results",
            )
            this.flushDeferredMessages()
        }, 30000)

        // Poll video state every 500ms
        this.videoEndWatcher = setInterval(() => {
            const video = findVideoElement()
            if (!video || video.paused || video.ended || video.readyState < 2) {
                console.log(
                    "[ODP] Video finished — delivering deferred results",
                )
                this.flushDeferredMessages()
            }
        }, 500)
    }

    /**
     * Deliver all queued results/songEnd messages to the game engine
     * and clean up timers.
     */
    private flushDeferredMessages(): void {
        if (this.deferralTimer) {
            clearTimeout(this.deferralTimer)
            this.deferralTimer = null
        }
        if (this.videoEndWatcher) {
            clearInterval(this.videoEndWatcher)
            this.videoEndWatcher = null
        }

        const msgs = this.deferredMessages.splice(0)
        if (msgs.length === 0) return

        console.log(`[ODP] Flushing ${msgs.length} deferred message(s)`)
        for (const ev of msgs) {
            // Re-dispatch through the onmessage handler (which won't
            // re-defer since the video is now stopped)
            // @ts-ignore - accessing inherited property
            const handler = super.onmessage
            if (handler) {
                handler.call(this, ev)
            }
        }
    }

    // --- Private Handlers ---

    private handleConnectedMessage(odpMsg: Connected): void {
        waitForElm(".danceroom__label").then((p) => {
            if (!(p instanceof HTMLParagraphElement)) return
            const observer = new MutationObserver(() => {
                if (p.innerText != odpMsg.hostId) {
                    p.innerText = odpMsg.hostId
                }
            })
            observer.observe(p, {
                attributes: true,
                subtree: true,
                childList: true,
            })
            p.innerText = odpMsg.hostId
        })

        // Check region mismatch
        const localRegion = getJDNRegion(this.url)
        if (
            odpMsg.region &&
            localRegion.regionCode !== "unknown" &&
            odpMsg.region !== localRegion.regionCode
        ) {
            const hostRegionName = getJDNRegion(odpMsg.region).humanReadable
            const localRegionName = localRegion.humanReadable

            const showVPNWarning = () => {
                // @ts-ignore - accessing JDN game global
                if (globalThis.jd?.popUp?.build) {
                    // @ts-ignore - accessing JDN game global
                    globalThis.jd.popUp.build({
                        title: "VPN Required",
                        content: `The host is connected to the Just Dance server in ${hostRegionName} while you are connected to the Just Dance Server in ${localRegionName}. To be able to join the Dance Room with your phone, you will need to use a VPN app with a VPN server close to the server of the host. Otherwise, you will get an error message that says that the dance room does not exist.`,
                        isError: false,
                    })
                } else {
                    // JDN UI not ready yet, retry after a short delay
                    setTimeout(showVPNWarning, 1000)
                }
            }
            showVPNWarning()
        }
    }

    private handleSongStartMessage(odpMsg: SongStart): void {
        let adjustedTime = odpMsg.startTime
        if (this.orchestrator) {
            adjustedTime += this.orchestrator.clockOffset
            console.log(
                `[ODP] Sync: Adjusting Host Time ${odpMsg.startTime} by ${this.orchestrator.clockOffset}ms -> ${adjustedTime}`,
            )
        }
        songStartSync(adjustedTime)
    }

    private handleServerMessage(odpMsg: ServerMsg): void {
        // @ts-ignore - accessing JDN game global
        if (globalThis.jd && globalThis.jd.popUp) {
            // @ts-ignore - accessing JDN game global
            globalThis.jd.popUp.build({
                title: odpMsg.title,
                content: odpMsg.content,
                isError: odpMsg.isError,
                timer: odpMsg.timer,
                hideCancelation: odpMsg.hideCancellation,
            })
        }
    }

    /**
     * Clear stale game UI elements between songs.
     * Prevents leftover scores/results from the previous song
     * from persisting into the next one.
     */
    private cleanupBetweenSongs(msg: JDNMessage): void {
        // Trigger cleanup when transitioning out of gameplay
        const cleanupFuncs = ["songEnd", "returnToLobby", "results"]
        if (!cleanupFuncs.includes(msg.func)) return

        console.log(`[ODP] Song transition (${msg.func}) — cleaning up UI`)

        try {
            // Remove stale score popups / feedback overlays
            document
                .querySelectorAll(
                    ".player-score-popup, .score-popup, .feedback-overlay",
                )
                .forEach((el) => el.remove())

            // Remove ghost player markers from previous song
            document.querySelectorAll(".player--new.ghost").forEach((el) => {
                el.classList.remove("ghost", "player--new")
            })
        } catch (e) {
            console.warn("[ODP] Cleanup error (non-fatal):", e)
        }
    }

    private handleHostMessage(msg: JDNMessage): void {
        // Initialize P2P on room connection
        if (
            (msg.func === "connect" && msg.roomNumber) ||
            (msg.func === "registerRoom" && msg.roomID)
        ) {
            const roomId = msg.roomNumber || msg.roomID
            console.log("[ODP] Host connected to Room: " + roomId)
            this.orchestrator?.initialize(true, roomId.toString())
        } else if (msg.roomNumber && !this.orchestrator?.isInitialized) {
            // Fallback
            console.log(
                "[ODP] Found roomNumber in msg (" +
                    msg.func +
                    "): " +
                    msg.roomNumber,
            )
            this.orchestrator?.initialize(true, msg.roomNumber.toString())
        }

        // Track state and broadcast
        this.orchestrator?.handleMessage(msg)
        this.orchestrator?.broadcastMessage(msg)
    }

    private handleP2PData(data: unknown, _peerId: string): void {
        // Handle RTT echo for handshake latency measurement (host only)
        if (
            this.isHost &&
            data != null &&
            typeof data === "object" &&
            "__type" in data &&
            (data as { __type: string }).__type === "__rttEcho" &&
            "t1" in data
        ) {
            this.orchestrator?.handleRTTEcho(
                data as { __type: string; t1: number },
                _peerId,
            )
            return
        }

        // Handle forwarded messages from followers (host only)
        if (
            this.isHost &&
            data != null &&
            typeof data === "object" &&
            "__type" in data &&
            (data as { __type: string }).__type === "__forward" &&
            "payload" in data
        ) {
            const payload = (data as { payload: unknown }).payload
            // Validate: must be a string with at least a 4-char prefix + some content
            if (typeof payload === "string" && payload.length > 4) {
                try {
                    // Validate it's a parseable JDN message
                    wsStringToObject(payload)
                    super.send(payload)
                } catch {
                    console.warn("[ODP] Rejected invalid forwarded message")
                }
            }
            return
        }

        // Strings (ODP protocol messages like "06BJ...") are passed as-is
        const dataStr = typeof data === "string" ? data : wsObjectToString(data)
        const event = new MessageEvent("message", {
            data: dataStr,
            origin: "wss://p2p-simulation",
        })

        // Route through the onmessage interceptor so ODP messages
        // (Connected, SongStart, ServerMsg) are properly handled
        // @ts-ignore - accessing inherited property
        const handler = super.onmessage
        if (handler) {
            handler.call(this, event)
        } else if (this.gameOnMessage) {
            // @ts-ignore - calling handler
            this.gameOnMessage(event)
        } else {
            console.warn("[ODP] NO MESSAGE HANDLER FOUND!")
        }
    }
}
