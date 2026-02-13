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

    // Deferral queue: holds results/songEnd events until sync
    private deferredMessages: MessageEvent[] = []
    private deferralTimer: ReturnType<typeof setTimeout> | null = null
    private videoEndWatcher: ReturnType<typeof setInterval> | null = null
    private hostResultsSyncActive = false
    private isFlushing = false
    private followerReadinessWatcherActive = false

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

            // 2.2. Follower start sync: begin watching video readiness
            if (this.isFollower && msg) {
                if (msg.func === "songStart" || msg.func === "songLaunch") {
                    this.startFollowerReadinessWatcher()
                }
            }

            // 2.3. Host end sync: defer results for synchronized display
            if (this.isHost && msg && !this.isFlushing) {
                const endFuncs = ["results", "songEnd"]
                if (endFuncs.includes(msg.func)) {
                    // Broadcast to followers (they will defer)
                    this.handleHostMessage(msg)
                    // Defer host's own display
                    this.deferredMessages.push(ev)
                    // Start waiting for followers
                    if (!this.hostResultsSyncActive) {
                        this.handleHostResultsSync()
                    }
                    return
                }
            }

            // 2.4. Follower end sync: always defer results, wait for
            // host __showResults signal before flushing.
            if (this.isFollower && msg && !this.isFlushing) {
                const endFuncs = ["results", "songEnd"]
                if (endFuncs.includes(msg.func)) {
                    console.log(
                        "[Sync] Deferring results, waiting for host signal",
                    )
                    this.deferredMessages.push(ev)
                    // If video already done, report immediately
                    const video = findVideoElement()
                    if (!video || video.ended || video.paused) {
                        this.sendControlToHost({
                            __type: "__readyForResults",
                        })
                    } else {
                        this.startFollowerEndWatcher()
                    }
                    // Safety timeout (30s)
                    if (!this.deferralTimer) {
                        this.deferralTimer = setTimeout(() => {
                            console.log(
                                "[ODP] Deferral safety timeout (30s) — flushing results",
                            )
                            this.flushDeferredMessages()
                        }, 30000)
                    }
                    return
                }
            }

            // 2.5. Clean up stale UI between songs
            if (msg) {
                this.cleanupBetweenSongs(msg)
            }

            // 3. Host-specific logic
            if (this.isHost && msg && !this.isFlushing) {
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
                    // Broadcast JDN message immediately so followers start loading
                    this.orchestrator?.broadcastRaw(msg)

                    // Start synchronized song start process
                    this.orchestrator?.resetSyncGates()
                    this.handleSyncedSongStart()
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

    // --- Sync Helpers ---

    /**
     * Host: snapshot when the host video actually started,
     * wait for followers to buffer, then broadcast the real
     * start timestamp so followers can sync to the host.
     *
     * The host video is already playing (the game engine loaded
     * it before calling ws.send(songStart)), so we must NOT
     * seek it — the host is the authoritative timeline.
     */
    private async handleSyncedSongStart(): Promise<void> {
        console.log("[Sync] Waiting for host video readiness...")

        await this.waitForHostVideoReady()

        // Snapshot the host's actual start time from its current
        // playback position BEFORE we wait for followers.
        const video = findVideoElement()
        const hostStartTime =
            Date.now() - (video ? video.currentTime * 1000 : 0)
        console.log(
            `[Sync] Host video start time: ${hostStartTime} ` +
                `(video at ${video?.currentTime?.toFixed(2) ?? 0}s)`,
        )

        this.orchestrator?.markHostVideoReady()

        // Wait for all followers (or timeout)
        await this.orchestrator?.waitForAllReady(15000)

        console.log("[Sync] All ready (or timeout). Broadcasting start time.")

        // Broadcast the host's actual start timestamp.
        // Followers will sync their video to this via songStartSync.
        this.orchestrator?.broadcastRaw(
            "06BJ" +
                JSON.stringify({
                    tag: "SongStart",
                    contents: { startTime: hostStartTime },
                }),
        )

        // Host video is already playing correctly — no seek needed.
    }

    /**
     * Polls until a <video> element exists with readyState >= 3
     * (HAVE_FUTURE_DATA), meaning playback can start without stalling.
     * Times out after 20 seconds to prevent hanging forever if the
     * video element never appears or never buffers.
     */
    private waitForHostVideoReady(): Promise<void> {
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                console.warn("[Sync] Host video readiness timeout (20s)")
                resolve()
            }, 20000)

            const check = () => {
                const video = findVideoElement()
                if (video && video.readyState >= 3) {
                    clearTimeout(timeout)
                    resolve()
                } else {
                    setTimeout(check, 200)
                }
            }
            check()
        })
    }

    /**
     * Host: wait for all followers to report __readyForResults,
     * then broadcast __showResults and flush own deferred messages.
     */
    private async handleHostResultsSync(): Promise<void> {
        this.hostResultsSyncActive = true
        console.log("[Sync] Host waiting for followers to finish...")

        await this.orchestrator?.waitForAllFinished(15000)

        console.log("[Sync] Everyone finished. Showing results.")

        // Tell every follower to flush their deferred results
        this.orchestrator?.broadcastRaw({ __type: "__showResults" })

        // Flush host's own deferred messages
        this.flushDeferredMessages()
        this.hostResultsSyncActive = false
    }

    /**
     * Follower: poll for the video element to become sufficiently
     * buffered, then signal the host with __readyToStart.
     * Guarded to prevent duplicate watchers (e.g. if both songStart
     * and songLaunch arrive).
     */
    private startFollowerReadinessWatcher(): void {
        if (this.followerReadinessWatcherActive) return
        this.followerReadinessWatcherActive = true

        const checkInterval = setInterval(() => {
            const video = findVideoElement()
            if (video && video.readyState >= 3) {
                clearInterval(checkInterval)
                this.followerReadinessWatcherActive = false
                console.log("[Sync] Video ready, signaling host")
                this.sendControlToHost({ __type: "__readyToStart" })
            }
        }, 200)

        // Safety: stop checking after 20 seconds and send fallback
        // so the host doesn't wait the full gate timeout.
        setTimeout(() => {
            if (this.followerReadinessWatcherActive) {
                clearInterval(checkInterval)
                this.followerReadinessWatcherActive = false
                console.warn(
                    "[Sync] Readiness watcher timeout (20s) — signaling host anyway",
                )
                this.sendControlToHost({ __type: "__readyToStart" })
            }
        }, 20000)
    }

    /**
     * Follower: watch for the video to finish playing, then
     * signal the host with __readyForResults.
     */
    private startFollowerEndWatcher(): void {
        if (this.videoEndWatcher) return

        this.videoEndWatcher = setInterval(() => {
            const video = findVideoElement()
            if (!video || video.paused || video.ended || video.readyState < 2) {
                console.log("[Sync] Video finished — signaling host")
                clearInterval(this.videoEndWatcher!)
                this.videoEndWatcher = null
                this.sendControlToHost({
                    __type: "__readyForResults",
                })
            }
        }, 500)
    }

    /**
     * Send a P2P control message toward the host.
     * For followers broadcastRaw reaches only the host.
     */
    private sendControlToHost(msg: unknown): void {
        this.orchestrator?.broadcastRaw(msg)
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
        this.isFlushing = true
        for (const ev of msgs) {
            // Re-dispatch through the onmessage handler
            // (isFlushing prevents re-deferral or re-broadcast)
            // @ts-ignore - accessing inherited property
            const handler = super.onmessage
            if (handler) {
                handler.call(this, ev)
            }
        }
        this.isFlushing = false
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

        // Handle sync control messages
        if (data != null && typeof data === "object" && "__type" in data) {
            const typed = data as { __type: string }
            if (typed.__type === "__readyToStart") {
                this.orchestrator?.handleReadyToStart(_peerId)
                return
            }
            if (typed.__type === "__readyForResults") {
                this.orchestrator?.handleReadyForResults(_peerId)
                return
            }
            if (typed.__type === "__showResults") {
                this.flushDeferredMessages()
                return
            }
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
