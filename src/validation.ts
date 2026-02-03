import { JDNMessage } from "./model/GameStateManager"

/**
 * Validates a Room ID for P2P connections.
 * Must be alphanumeric, 1-20 characters.
 */
export function isValidRoomId(id: string): boolean {
    if (typeof id !== "string") return false
    if (id.length < 1 || id.length > 20) return false
    return /^[a-zA-Z0-9]+$/.test(id)
}

/**
 * Type guard for JDN protocol messages.
 * Validates that the data has a `func` property of type string.
 */
export function isJDNMessage(data: unknown): data is JDNMessage {
    return (
        typeof data === "object" &&
        data !== null &&
        "func" in data &&
        typeof (data as Record<string, unknown>).func === "string"
    )
}

/**
 * Type guard for internal P2P control messages.
 */
export function isP2PControlMessage(
    data: unknown,
): data is { __type: string; t1?: number; serverTime?: number } {
    return (
        typeof data === "object" &&
        data !== null &&
        "__type" in data &&
        typeof (data as Record<string, unknown>).__type === "string"
    )
}

/**
 * Sanitizes P2P payload by validating structure.
 * Returns null if the payload is invalid or potentially malicious.
 */
export function sanitizeP2PPayload(data: unknown): JDNMessage | null {
    if (!isJDNMessage(data)) return null

    // Validate func is a known safe value (no control characters)
    const func = data.func
    if (!/^[a-zA-Z]+$/.test(func)) {
        console.warn("[ODP] Rejected P2P message with invalid func:", func)
        return null
    }

    return data
}

/**
 * Safe JSON parse that returns null on failure instead of throwing.
 * Prevents prototype pollution by checking for __proto__ keys.
 */
export function safeJsonParse<T>(str: string): T | null {
    try {
        const parsed = JSON.parse(str) as T

        // Check for prototype pollution attempts (only own properties, not inherited)
        if (
            typeof parsed === "object" &&
            parsed !== null &&
            Object.hasOwn(parsed, "__proto__")
        ) {
            console.warn("[ODP] Rejected JSON with prototype pollution attempt")
            return null
        }

        return parsed
    } catch {
        return null
    }
}

/**
 * Validates that a string is safe for use in UI contexts.
 * Strips or escapes potentially dangerous content.
 */
export function sanitizeForUI(str: string): string {
    if (typeof str !== "string") return ""
    // Remove script tags and event handlers
    return str
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/on\w+\s*=/gi, "data-blocked=")
        .slice(0, 1000) // Limit length
}
