import * as storage from "./storage"
import { InjectData } from "./model/inject-data"

async function main(): Promise<void> {
    const odpClient = await storage.getODPClient()
    console.log("ODP: odpClient from storage: ", odpClient)

    // P2P mode does not use relay server redirect
    const injectData = new InjectData(
        null,
        odpClient ? JSON.stringify(odpClient) : null,
    )

    const script = document.createElement("script")
    // @ts-ignore
    script.dataset.injectData = JSON.stringify(injectData)
    script.src = browser.runtime.getURL("js/bundle/redirect.js")
    document.documentElement.appendChild(script)
}

main()
