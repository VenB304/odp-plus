import { InjectData } from "./model/inject-data"
import { OdpWebSocket } from "./odp-websocket"
import { waitForElm } from "./wait-for-elem"

// @ts-ignore
const NativeWebSocket = globalThis.WebSocket

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
}

main()
