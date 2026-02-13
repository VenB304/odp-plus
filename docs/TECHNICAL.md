# ODP+ Technical Documentation

This document is for developers who want to understand how ODP+ works or contribute to the project.

---

## How It Works

ODP+ uses **WebRTC** (via [PeerJS](https://peerjs.com)) for direct peer-to-peer connections between browsers.

### Connection Flow

1. **Host** connects to Just Dance Now normally and starts a room
2. **Followers** connect to the Host via WebRTC instead of JDN servers
3. Host **relays game state** (song selection, timing events) to Followers
4. **Clock sync** ensures all clients see the same video frame

### Architecture

```
┌─────────────┐     WebSocket      ┌─────────────┐
│   Phone 1   │ ◄─────────────────►│ JDN / JDNP  │
└─────────────┘    (scoring ✅)     │   Server    │
                                   └─────────────┘
┌─────────────┐     WebSocket             ▲
│   Phone 2   │ ◄─────────────────────────┤
└─────────────┘    (scoring ✅)            │
                                          │
┌─────────────┐     WebSocket             │
│ Browser     │ ◄─────────────────────────┘
│ (Host)      │        (video, pictograms, scores display)
└──────┬──────┘
       │ WebRTC (P2P)
       ├──────────────────┐
       ▼                  ▼
┌─────────────┐    ┌─────────────┐
│ Browser     │    │ Browser     │
│ (Follower)  │    │ (Follower)  │
└─────────────┘    └─────────────┘
```

### Scoring — Unaffected by ODP+

ODP+ **only runs in the browser tab** (the screen showing video/pictograms). It has no involvement in the phone-to-server connection.

- **Phones connect directly** to JDN/JDNP servers — ODP+ never sees or touches phone traffic
- Score submission, leaderboards, and account data flow through the phone → server connection untouched
- All scores are saved and uploaded normally regardless of ODP+ being active

What ODP+ actually syncs between browsers: **video playback timing**, **pictogram/move display**, and **score overlays** (display only, not the actual score data).

### Scoring & High Latency

Scoring is handled by your **phone** (connects directly to JDN) — ODP+ syncs the video, pictograms, and scoring display between Host and Followers.

| Client | Syncs with | Purpose |
|--------|------------|---------|
| Phone | JDN servers | Scoring (input) |
| Browser (Host) | JDN servers | Video, Pictograms, Scores |
| Browser (Follower) | Host via ODP+ | Video, Pictograms, Scores (offset-corrected) |

**How sync works:**
- Host relays all game messages (scoring, pictograms, moves) to Followers via P2P
- ODP+ calculates a clock offset so follower video matches host timing
- Host video is aligned with JDN's song clock
- Therefore, follower video is also aligned with JDN timing
- Phone expects moves at JDN timing — which now matches the video ✅

### Follower Message Forwarding

Followers forward gameplay-related messages (e.g., `playerFeedBack`, `playerMoves`) back to the Host via P2P. The Host relays these to the real JDN/JDNP server so the game engine receives browser-side game state from all participants. Connection/room messages (`connect`, `registerRoom`, `ping`, `pong`) are **not** forwarded to avoid duplicate registrations.

### Results Deferral

When the Host's video stream fails (common on JDNP with distant CDNs), the server may send `results`/`songEnd` before followers have finished watching. ODP+ defers these messages on followers:

- If `results` or `songEnd` arrives while the follower's video is **still playing**, the message is queued
- The queued messages are delivered when the video finishes (pauses/ends) or the element is removed
- A **30-second safety timeout** prevents followers from getting stuck indefinitely
- Host behavior is unchanged — the Host always processes server messages immediately

### Clock Sync Details

- **Initial sync**: 5 ping messages during P2P handshake + real RTT measurement via `__rttProbe`/`__rttEcho`
- **Periodic re-sync**: Every 30 seconds to prevent clock drift
- **Outlier rejection**: RTT measurements > 2.5× the rolling median are discarded
- **Median offset**: Uses the median of the last 7 offset samples instead of the raw latest value, preventing jitter from corrupting sync
- **Handshake latency**: The `clientSyncCompleted` message uses the **measured RTT** to each peer (not a hardcoded value), ensuring the JDN game engine calibrates move timing correctly for high-latency connections

---

## Performance Limits

| Scenario | Players | Host Upload | Status |
|----------|---------|-------------|--------|
| Small Party | 1-10 | < 1 Mbps | ✨ Perfect |
| Classroom | 10-50 | 2-8 Mbps | ✅ Good |
| Streamer | 50-100 | 10-20 Mbps | ⚠️ Risky |
| Massive Event | 200+ | > 50 Mbps | 🛑 Not Recommended |

---

## vs. Original Extension

| Feature | ODP+ | Original |
|---------|------|----------|
| Server Required | **No (P2P)** | Yes (free public server available) |
| Cost | **Free** | Free (public) or hosting costs |
| Latency | **Low** | Higher (relay hop) |
| Resilience | **Auto-Reconnect** | Manual |

---

## Using Releases

For most users, we recommend downloading pre-built releases instead of building from source.

### Getting the Latest Release

1. Visit the [Releases page](https://github.com/VenB304/odp-plus/releases)
2. Download the latest `odp-plus-x.x.x.zip` file
3. Extract the ZIP file
4. Load the extracted folder as an unpacked extension in your browser

This gives you a production-ready build without needing Node.js or build tools.

---

## Development

### Prerequisites

- Node.js (LTS recommended)
- npm

### Commands

```bash
npm install        # Install dependencies
npm run build      # Build for production
npm start          # Run in Firefox (dev mode)
npm run startC     # Run in Chrome (dev mode)
npm run lint       # Run linter
npm run format     # Format code with Prettier
npm run check      # Run all checks (build, lint, format)
npm run clean      # Clean build artifacts
npm run release    # Create release zip
```

### Project Structure

```
ODP+/
├── src/
│   ├── css/
│   │   └── odp.css             # Popup & theme styles (dark/light)
│   ├── model/
│   │   ├── GameStateManager.ts # Game state tracking & late-joiner replay
│   │   ├── ODPClient.ts        # Host/Follower client type model
│   │   └── inject-data.ts      # Script injection data model
│   ├── manifest.json           # Extension manifest (V3)
│   ├── popup.html              # Extension popup UI
│   ├── popup.ts                # Popup logic & mode selection
│   ├── odp-websocket.ts        # WebSocket proxy & ODP message handling
│   ├── p2p-client.ts           # PeerJS P2P client & clock sync
│   ├── P2POrchestrator.ts      # P2P lifecycle, handshake & broadcasting
│   ├── validation.ts           # Input & message validation
│   ├── odp-msg.ts              # ODP protocol message types
│   ├── jdn-protocol.ts         # JDN WebSocket protocol helpers
│   ├── redirect.ts             # WebSocket override & JDNP CDN rewriting
│   ├── inject-redirect.ts      # Content script injector
│   ├── storage.ts              # Browser storage (mode, CDN pref)
│   ├── utils.ts                # Utilities (sleep, region detection)
│   └── wait-for-elem.ts        # DOM element observer
├── dist/                       # Built extension (generated)
├── docs/                       # Documentation
└── img/                        # Extension icons
```

---

## JDNP CDN Override

JustDanceNowPlus.ru streams video from two CDN servers:

| CDN Hostname | Location |
|---|---|
| `hls-us.justdancenowplus.ru` | United States |
| `hls-ru.justdancenowplus.ru` | Russia (St. Petersburg) |

The JDNP server assigns a CDN based on your IP address, but this isn't always optimal (e.g., a Philippines user may get `hls-us`, causing stream failures due to high latency).

ODP+ can override the CDN assignment:

| Setting | Behavior |
|---------|----------|
| **Server Default** | No interception — uses whatever JDNP assigns |
| **Auto (fastest)** | Pings both CDNs on page load, picks the one that responds first |
| **US CDN** | Forces `hls-us.justdancenowplus.ru` |
| **Russia CDN** | Forces `hls-ru.justdancenowplus.ru` |

**How it works:** ODP+ intercepts `XMLHttpRequest.open()` and `fetch()` calls to rewrite CDN hostnames in HLS video requests (`.m3u8` manifests and `.ts` segments). This only activates on `justdancenowplus.ru`.

The setting is available in the ODP+ popup under the collapsible "JDNP Video CDN" section and persists across sessions.

---

## Supported Sites

| Site | Status |
|------|--------|
| [justdancenow.com](https://justdancenow.com) | ✅ Supported |
| [justdancenowplus.ru](https://justdancenowplus.ru) | ⚠️ Partial (see below) |

**JustDanceNow+ Compatibility:**
- ✅ OurUI (2024), 2024, 2020, Experiments
- ❌ 2018, 2017, 2015

**JDNP-Specific Behavior:**
- Video detection uses `document.querySelector("video")` fallback (JDNP doesn't use jQuery `#in-game_video`)
- Song start detection falls back to checking video element `readyState >= 2 && !paused` (JDNP doesn't set `jd.video.started`)
- VPN warning popup defers display until `jd.popUp` is initialized (may not be ready during early P2P handshake)
- CDN override available to work around JDNP's suboptimal CDN assignment for distant users

---

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `npm run check` to verify
5. Submit a Pull Request

---

## License

[AGPL-3.0](../LICENSE)
