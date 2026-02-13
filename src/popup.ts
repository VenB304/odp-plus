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
const statusMessage = document.getElementById(
    "status-message",
) as HTMLDivElement

const radioDisabled = "Disabled"
const radioHost = "Host"
const radioFollower = "Follower"

async function updateUI() {
    const radioValue = radio.value
    if (radioValue === radioFollower) {
        inputSection.classList.remove("hidden")
        followCodeField.disabled = false
        // Restore previously saved follower Room ID if field is empty
        if (!followCodeField.value) {
            const savedId = await storage.getSavedFollowerId()
            if (savedId) {
                followCodeField.value = savedId
            }
        }
        followCodeField.focus()
    } else {
        inputSection.classList.add("hidden")
        followCodeField.disabled = true
    }
}

function showStatus(message: string, autoHide = false) {
    statusMessage.textContent = message
    statusMessage.classList.remove("hidden")
    if (autoHide) {
        setTimeout(() => {
            statusMessage.classList.add("hidden")
        }, 3000)
    }
}

function registerHandlers() {
    radio.forEach((r) => {
        r.addEventListener("change", () => updateUI())
    })

    followCodeField.addEventListener("input", () => {
        // Clear error styling as the user types
        statusMessage.classList.add("hidden")
        followCodeField.placeholder = "e.g. 1999"
    })

    form.onsubmit = async function (this: GlobalEventHandlers, e: Event) {
        e.preventDefault()
        await storage.removeServer() // Ensure no legacy server config

        const radioValue = radio.value

        if (radioValue === "" || radioValue === radioDisabled) {
            await storage.removeODPClient()
        } else if (radioValue == radioHost) {
            // Host ID is managed automatically by PeerJS/RoomID detection
            await storage.setODPClient(new ODPClient(new Host("ODP-Host")))

            // Show message to Host before reloading
            showStatus(
                "Page will reload. Share your Room Code with friends to let them join!",
            )
            await new Promise((resolve) => setTimeout(resolve, 1500))
        } else if (radioValue == radioFollower) {
            const code = followCodeField.value.trim()
            if (!code || !isValidRoomId(code)) {
                followCodeField.placeholder = "REQUIRED!"
                showStatus(
                    code
                        ? "Room ID must be alphanumeric (1-20 chars)"
                        : "Please enter a Room ID",
                    true,
                )
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
    const modeIndicator = document.getElementById(
        "current-mode",
    ) as HTMLDivElement

    if (odpClient == undefined) {
        radioValue = radioDisabled
        modeIndicator.textContent = "● ODP+ Disabled"
        modeIndicator.className = "current-mode mode-disabled"
    } else if (odpClient.contents instanceof Host) {
        radioValue = radioHost
        modeIndicator.textContent = "● Hosting"
        modeIndicator.className = "current-mode mode-host"
    } else {
        followCodeField.value = odpClient.contents.hostToFollow
        radioValue = radioFollower
        modeIndicator.textContent =
            "● Following: " + odpClient.contents.hostToFollow
        modeIndicator.className = "current-mode mode-follower"
    }

    radio.value = radioValue
    await updateUI()
}

main()
