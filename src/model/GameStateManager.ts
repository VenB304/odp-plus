export interface JDNMessage {
    func: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any
}

export interface SongState {
    tabRest: JDNMessage | null
    navRest: JDNMessage | null
    selected: JDNMessage | null
    coachSelected: JDNMessage | null
    neverDanceAlone: JDNMessage | null
    launched: JDNMessage | null
    start: JDNMessage | null
}

export class GameStateManager {
    private state: SongState = {
        tabRest: null,
        navRest: null,
        selected: null,
        coachSelected: null,
        neverDanceAlone: null,
        launched: null,
        start: null,
    }

    private players: JDNMessage[] = []
    private _isMidSong = false

    public get isMidSong(): boolean {
        return this._isMidSong
    }

    public handleMessage(msg: JDNMessage) {
        // Track Players
        if (msg.func === "playerJoined") {
            this.players.push(msg)
        } else if (msg.func === "playerLeft") {
            this.players = this.players.filter(
                (p: JDNMessage) => p.newPlayer.id !== msg.playerID,
            )
        }

        // Track Song State
        if (msg.func === "tabRest") {
            this.state.tabRest = msg
        } else if (msg.func === "navRest") {
            this.state.navRest = msg
        } else if (msg.func === "songSelected") {
            this.state.selected = msg
        } else if (msg.func === "coachSelected") {
            this.state.coachSelected = msg
        } else if (msg.func === "neverDanceAlone") {
            this.state.neverDanceAlone = msg
        } else if (msg.func === "songLaunched") {
            this.state.launched = msg
        } else if (msg.func === "songStart") {
            this.state.start = msg
            this._isMidSong = true
        } else if (msg.func === "songEnd" || msg.func === "returnToLobby") {
            this._isMidSong = false
            this.resetSongState()
        }
    }

    public getReplayMessages(): JDNMessage[] {
        const replay: JDNMessage[] = []

        // 1. Players
        this.players.forEach((p) => replay.push(p))

        // 2. Navigation / Tab
        if (this.state.tabRest) replay.push(this.state.tabRest)
        if (this.state.navRest) replay.push(this.state.navRest)

        // 3. Song Selection - SKIP if mid-song to prevent UI crashes on late join
        if (!this.isMidSong) {
            if (this.state.selected) replay.push(this.state.selected)
            if (this.state.coachSelected) replay.push(this.state.coachSelected)
            if (this.state.neverDanceAlone)
                replay.push(this.state.neverDanceAlone)

            // 4. Launch & Start
            if (this.state.launched) replay.push(this.state.launched)
            if (this.state.start) replay.push(this.state.start)
        } else {
            console.log(
                "[ODP] Skipping song state replay - song is currently playing",
            )
        }

        return replay
    }

    private resetSongState() {
        // Keep tabRest/navRest as they define where we are in the menu
        // Reset specific song selection details
        this.state.selected = null
        this.state.coachSelected = null
        this.state.neverDanceAlone = null
        this.state.launched = null
        this.state.start = null
    }
}
