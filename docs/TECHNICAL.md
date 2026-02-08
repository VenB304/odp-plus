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
│   Phone 1   │ ◄─────────────────►│ JDN Server  │
└─────────────┘                    └─────────────┘
                                          ▲
┌─────────────┐     WebSocket             │
│   Phone 2   │ ◄─────────────────────────┤
└─────────────┘                           │
                                          │
┌─────────────┐     WebSocket             │
│ Browser     │ ◄─────────────────────────┘
│ (Host)      │
└──────┬──────┘
       │ WebRTC (P2P)
       ▼
┌─────────────┐
│ Browser     │
│ (Follower)  │
└─────────────┘
```

### Scoring & High Latency

Scoring is handled by your **phone** (connects directly to JDN) — ODP+ only syncs the video.

| Client | Syncs with | Purpose |
|--------|------------|---------|
| Phone | JDN servers | Scoring |
| Browser (Host) | JDN servers | Video |
| Browser (Follower) | Host via ODP+ | Video (offset-corrected) |

**Why scoring works for high-latency followers:**
- ODP+ calculates a clock offset so follower video matches host timing
- Host video is aligned with JDN's song clock
- Therefore, follower video is also aligned with JDN timing
- Phone expects moves at JDN timing — which now matches the video ✅

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
│   ├── css/              # Popup styles
│   ├── manifest.json     # Extension manifest
│   ├── popup.html        # Extension popup UI
│   ├── odp-websocket.ts  # WebSocket proxy logic
│   ├── p2p-client.ts     # PeerJS P2P client
│   ├── game-state.ts     # Game state management
│   ├── validation.ts     # Message validation
│   └── ...
├── dist/                 # Built extension (generated)
├── docs/                 # Documentation
└── img/                  # Extension icons
```

---

## Supported Sites

| Site | Status |
|------|--------|
| [justdancenow.com](https://justdancenow.com) | ✅ Supported |
| [justdancenowplus.ru](https://justdancenowplus.ru) | ⚠️ Partial |

**JustDanceNow+ Compatibility:**
- ✅ OurUI (2024), 2024, 2020, Experiments
- ❌ 2018, 2017, 2015

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
