export function wsStringToObject(m: string): unknown {
    return JSON.parse(m.substring(4, m.length))
}

export function wsObjectToString(o: unknown): string {
    const string = JSON.stringify(o)
    const prefix = string.length.toString(36).padStart(4, "0")
    return prefix + string
}

export function extractFunctionString(m: string): string {
    try {
        const obj = wsStringToObject(m) as { func?: string }
        return obj?.func ?? ""
    } catch {
        return ""
    }
}

export function isSyncMessage(m: string) {
    return m.endsWith('"func":"sync"}')
}
