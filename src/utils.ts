export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

const humanReadableCountries: Record<string, string> = {
    ire: "Ireland",
    sap: "Brazil",
    sin: "Singapore",
    vir: "the United States",
}

export function getJDNRegion(url: string | URL): {
    regionCode: string
    humanReadable: string
} {
    const urlStr = url.toString()
    let host = ""
    try {
        if (url instanceof URL) {
            host = url.host
        } else {
            // fast hack for wss:// string
            const match = urlStr.match(/:\/\/(.[^/]+)/)
            if (match && match[1]) {
                host = match[1]
            } else {
                host = urlStr
            }
        }
    } catch (e) {
        return { regionCode: "unknown", humanReadable: "Unknown" }
    }

    const regionCode = host.substring(0, 3)
    const humanReadable = humanReadableCountries[regionCode] || regionCode
    return { regionCode, humanReadable }
}
