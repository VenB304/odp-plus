// we need to add .js when using imports: https://github.com/microsoft/TypeScript/issues/16577
import { Follower, Host, ODPClient } from "./model/ODPClient.js"
import * as storage from "./storage.js"
import { isValidRoomId } from "./validation.js"

async function reload(): Promise<void> {
    await browser.tabs.reload()
    await browser.runtime.reload()
}

const form = document.forms.namedItem("form")!
const followCodeField = form.elements.namedItem(
    "follow-code",
)! as HTMLInputElement
const inputSection = document.getElementById(
    "follower-input-section",
) as HTMLDivElement
const radio = form.elements.namedItem("setting") as RadioNodeList

const radioDisabled = "Disabled"
const radioHost = "Host"
const radioFollower = "Follower"

function updateUI() {
    const radioValue = radio.value
    if (radioValue === radioFollower) {
        inputSection.classList.remove("hidden")
        followCodeField.disabled = false
        followCodeField.focus()
    } else {
        inputSection.classList.add("hidden")
        followCodeField.disabled = true
    }
}

function registerHandlers() {
    radio.forEach((r) => {
        r.addEventListener("change", updateUI)
    })

    form.onsubmit = async function (this: GlobalEventHandlers, e: Event) {
        e.preventDefault()
        await storage.removeServer() // Ensure no legacy server config

        const radioValue = radio.value
        const statusMessage = document.getElementById(
            "status-message",
        ) as HTMLDivElement

        if (radioValue === "" || radioValue === radioDisabled) {
            await storage.removeODPClient()
        } else if (radioValue == radioHost) {
            // Host ID is managed automatically by PeerJS/RoomID detection
            await storage.setODPClient(new ODPClient(new Host("ODP-Host")))

            // Show message to Host before reloading
            statusMessage.textContent =
                "Page will reload. Share your Room Code with friends to let them join!"
            statusMessage.classList.remove("hidden")
            await new Promise((resolve) => setTimeout(resolve, 1500))
        } else if (radioValue == radioFollower) {
            const code = followCodeField.value.trim()
            if (!code || !isValidRoomId(code)) {
                followCodeField.placeholder = "REQUIRED!"
                statusMessage.textContent = code
                    ? "Room ID must be alphanumeric (1-20 chars)"
                    : "Please enter a Room ID"
                statusMessage.classList.remove("hidden")
                return
            }
            await storage.setODPClient(new ODPClient(new Follower(code)))
        }
        await reload()
        window.close() // Close popup on success
    }
}

async function main(): Promise<void> {
    registerHandlers()

    const odpClient = await storage.getODPClient()
    let radioValue: string

    if (odpClient == undefined) {
        radioValue = radioDisabled
    } else if (odpClient.contents instanceof Host) {
        radioValue = radioHost
    } else {
        followCodeField.value = odpClient.contents.hostToFollow
        radioValue = radioFollower
    }

    radio.value = radioValue
    updateUI()
}

main()
