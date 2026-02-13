import { InjectData } from "./model/inject-data"
import { OdpWebSocket } from "./odp-websocket"
import { waitForElm } from "./wait-for-elem"

// @ts-ignore
const NativeWebSocket = globalThis.WebSocket
const NativeXHROpen = XMLHttpRequest.prototype.open
const NativeFetch = globalThis.fetch

/**
 * Known JDNP CDN hostnames.
 * The server assigns one based on client IP, but it may not be optimal
 * for users far from both CDN locations (US & Russia/St. Petersburg).
 */
const JDNP_CDN_HOSTS = [
    "hls-us.justdancenowplus.ru",
    "hls-ru.justdancenowplus.ru",
]

/**
 * Auto-detect the fastest JDNP CDN by racing HEAD requests to both.
 * Returns the hostname that responds first within 5s, or null on failure.
 */
async function autoDetectBestCDN(): Promise<string | null> {
    try {
        const results = await Promise.allSettled(
            JDNP_CDN_HOSTS.map(async (host) => {
                const start = Date.now()
                const controller = new AbortController()
                const timeout = setTimeout(() => controller.abort(), 5000)
                try {
                    await NativeFetch(`https://${host}/`, {
                        method: "HEAD",
                        mode: "no-cors",
                        signal: controller.signal,
                    })
                    clearTimeout(timeout)
                    return { host, latency: Date.now() - start }
                } catch {
                    clearTimeout(timeout)
                    throw new Error(`${host} unreachable`)
                }
            }),
        )

        const fulfilled = results
            .map((r, i) => (r.status === "fulfilled" ? r.value : null))
            .filter((v): v is { host: string; latency: number } => v != null)

        if (fulfilled.length === 0) return null
        fulfilled.sort((a, b) => a.latency - b.latency)
        console.log(`[ODP] CDN auto-detect results:`, fulfilled)
        return fulfilled[0].host
    } catch {
        return null
    }
}

/**
 * Rewrites JDNP CDN URLs to use the preferred CDN host.
 * Only affects URLs matching hls-*.justdancenowplus.ru.
 */
function rewriteCDNUrl(url: string, targetHost: string): string {
    for (const cdnHost of JDNP_CDN_HOSTS) {
        if (url.includes(cdnHost) && cdnHost !== targetHost) {
            const rewritten = url.replace(cdnHost, targetHost)
            console.log(`[ODP] CDN redirect: ${cdnHost} → ${targetHost}`)
            return rewritten
        }
    }
    return url
}

/**
 * Install CDN URL rewriting for XHR and fetch.
 * HLS.js (used by JDNP) makes XHR requests for .m3u8 manifests and .ts segments.
 */
function installCDNRewriting(targetHost: string) {
    console.log(`[ODP] CDN rewriting active → ${targetHost}`)

    // Override XMLHttpRequest.open
    XMLHttpRequest.prototype.open = function (
        method: string,
        url: string | URL,
        ...args: unknown[]
    ) {
        const urlStr = url.toString()
        const rewritten = rewriteCDNUrl(urlStr, targetHost)
        // @ts-ignore - spread args for overloaded open()
        return NativeXHROpen.call(this, method, rewritten, ...args)
    }

    // Override fetch
    globalThis.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
        if (typeof input === "string") {
            input = rewriteCDNUrl(input, targetHost)
        } else if (input instanceof Request) {
            const rewritten = rewriteCDNUrl(input.url, targetHost)
            if (rewritten !== input.url) {
                input = new Request(rewritten, input)
            }
        } else if (input instanceof URL) {
            const rewritten = rewriteCDNUrl(input.toString(), targetHost)
            input = new URL(rewritten)
        }
        return NativeFetch.call(globalThis, input, init)
    }
}

function overWriteWebSocket(inData: InjectData) {
    // @ts-ignore
    globalThis.WebSocket = function (
        url: string | URL,
        protocols?: string | string[],
    ) {
        // Prevent intercepting PeerJS connections to avoid infinite loop
        if (url.toString().includes("peerjs")) {
            // @ts-ignore
            return new NativeWebSocket(url, protocols)
        }

        console.log("ODP intercepted: ", url)
        // In P2P mode, we pass the original URL to OdpWebSocket.
        // OdpWebSocket will handle whether to connect to it (Host) or ignore/mock it (Follower).
        return new OdpWebSocket(url, protocols ? protocols : [], inData.odpTag)
    }
}

async function blockUnsupportedBrowserPopup() {
    await waitForElm(".landing-popUp-noSupport")
    const button = await waitForElm(".pop-up__btn--validate")
    if (button instanceof HTMLButtonElement) {
        button.click()
    }
}

function main() {
    blockUnsupportedBrowserPopup()

    const inData: InjectData = JSON.parse(
        document.currentScript!.dataset.injectData!,
    )
    if (inData.redirectData != null || inData.odpTag != null) {
        overWriteWebSocket(inData)
    }

    // JDNP CDN rewriting (only on justdancenowplus.ru)
    if (
        location.hostname.includes("justdancenowplus.ru") &&
        inData.cdnPreference
    ) {
        setupCDNRewriting(inData.cdnPreference)
    }
}

async function setupCDNRewriting(preference: string) {
    if (preference === "auto") {
        console.log("[ODP] Auto-detecting best JDNP CDN...")
        const best = await autoDetectBestCDN()
        if (best) {
            installCDNRewriting(best)
        } else {
            console.warn("[ODP] CDN auto-detect failed, using server default")
        }
    } else if (JDNP_CDN_HOSTS.includes(preference)) {
        installCDNRewriting(preference)
    }
    // else "default" — don't intercept, use whatever JDNP assigns
}

main()
