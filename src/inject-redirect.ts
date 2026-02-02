import * as storage from "./storage"
import { InjectData, RedirectData } from "./model/inject-data"
import { ODPClient } from "./model/ODPClient"

const defaultServer = "onlinedance.party"

async function getRedirectData(odpClient: ODPClient): Promise<RedirectData | null> {
    return null; // P2P mode does not use a relay server redirect
}

async function main(): Promise<void> {
    const odpClient = await storage.getODPClient()
    console.log("ODP: odpClient from storage: ", odpClient)

    const redirectData = odpClient ? await getRedirectData(odpClient) : null
    const injectData = new InjectData(
        redirectData,
        odpClient ? JSON.stringify(odpClient) : null,
    )

    const script = document.createElement("script")
    // @ts-ignore
    script.dataset.injectData = JSON.stringify(injectData)
    script.src = browser.runtime.getURL("js/bundle/redirect.js")
    document.documentElement.appendChild(script)
}

main()
