export function wsStringToObject(m: string): unknown {
    return JSON.parse(m.substring(4, m.length))
}

export function wsObjectToString(o: unknown): string {
    const string = JSON.stringify(o)
    const prefix = string.length.toString(36).padStart(4, "0")
    return prefix + string
}

export function extractFunctionString(m: string) {
    const start = '000f{"func":"'.length
    const end = m.indexOf('"', start)
    return m.substring(start, end)
}

export function isSyncMessage(m: string) {
    return m.endsWith('"func":"sync"}')
}
