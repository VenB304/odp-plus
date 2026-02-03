export type ODPMsg = Connected | SongStart | ServerMsg

export class Connected {
    constructor(
        public hostId: string,
        public region?: string,
    ) { }
}

export class SongStart {
    constructor(public startTime: number) { }
}

export class ServerMsg {
    constructor(
        public title: string,
        public content: string | undefined,
        public isError: boolean | undefined,
        public timer: number | undefined,
        public hideCancellation: boolean | undefined,
    ) { }
}

export class UnknownMsg {
    constructor(public error: string) { }
}

export function parseODPMsg(m: string): ODPMsg | UnknownMsg | null {
    const prefix = "06BJ"
    if (!m.startsWith(prefix)) {
        return null
    }
    let o
    try {
        o = JSON.parse(m.substring(prefix.length))
    } catch (e) {
        return new UnknownMsg(`Could not parse JSON: ${m}`)
    }
    if (!Object.hasOwn(o, "tag")) {
        return new UnknownMsg(`No tag in JSON: ${m}`)
    }
    if (
        o.tag == "SongStart" &&
        Object.hasOwn(o, "contents") &&
        Object.hasOwn(o.contents, "startTime") &&
        typeof o.contents.startTime === "number"
    ) {
        return new SongStart(o.contents.startTime)
    } else if (
        o.tag == "Connected" &&
        Object.hasOwn(o, "contents") &&
        Object.hasOwn(o.contents, "hostId") &&
        typeof o.contents.hostId === "string"
    ) {
        return new Connected(o.contents.hostId, o.contents.region)
    } else if (
        o.tag === "ServerMsg" &&
        Object.hasOwn(o, "contents") &&
        ["title", "content"].every(
            (p) =>
                Object.hasOwn(o.contents, p) &&
                typeof o.contents[p] === "string",
        )
    ) {
        return new ServerMsg(
            o.contents.title,
            o.contents.content,
            o.contents.isError,
            o.contents.timer,
            o.contents.hideCancellation,
        )
    }
    return new UnknownMsg(`Unable to parse message: ${m}`)
}
