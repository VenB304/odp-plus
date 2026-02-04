# Online Dance Party Plus

## Preview
unmute for audio
<video src="https://github.com/user-attachments/assets/f93507ca-6521-47fc-a204-4c9c1094b4cc" controls width="100%"></video>

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL%203.0-blue.svg)](LICENSE)

**Play Just Dance Now with friends anywhere, using a direct Peer-to-Peer connection.**

ODP+ is a serverless implementation of the original [Online Dance Party](https://codeberg.org/ODP) extension. It enables synchronization of Just Dance Now sessions between clients using WebRTC.

---

## Quick Start

1. **Install** the extension (see [Installation](#installation))
2. **Host**: Open JDN → Start a room → Click ODP+ icon → Select "Host" → Apply → Share Room ID
3. **Join**: Open JDN → Click ODP+ icon → Select "Join" → Enter Room ID → Apply

> ⚠️ **Region Lock Warning**: If you and the Host are in different countries, you may need a VPN to join with your phone.

---

## Installation

**No pre-built release is currently available.** You must build from source.

### Build Steps

1. Install [Node.js](https://nodejs.org/) (LTS recommended)
2. Clone this repository
3. Run:
   ```bash
   npm install
   npm run build
   ```
4. Load the `dist` folder into your browser:
   - **Chrome/Edge/Brave**: `chrome://extensions` → Enable Developer Mode → Load unpacked
   - **Firefox**: `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → Select `manifest.json`

---

## Features

- **Serverless**: Direct WebRTC connection via PeerJS — no relay server needed
- **Synchronized Playback**: Clock sync aligns video across all devices
- **Auto-Reconnect**: Handles connection drops gracefully
- **Region Lock Detection**: Warns if VPN may be required

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| **"Room Not Found" on phone** | Use a VPN to match the Host's region |
| **Video out of sync** | Host should use a wired connection |
| **Can't connect to Host** | Try mobile hotspot, or allow UDP traffic |
| **Late joiner stuck in lobby** | Expected — wait for current song to end |

---

<details>
<summary><strong>Detailed Usage Guide</strong></summary>

### As a Host

1. Open [Just Dance Now](https://justdancenow.com)
2. Start a Dance Room
3. Click the **ODP+ Extension Icon**
4. Select **"Host a Party"** and click **Apply**
5. **Share your Room ID** with friends
6. Join the room on your phone (same Room ID)
7. Wait for friends to join, then start a song!

### As a Follower

1. Open [Just Dance Now](https://justdancenow.com)
2. Click the **ODP+ Extension Icon**
3. Select **"Join a Party"**
4. Enter the **Room ID** from the Host
5. Click **Apply**
6. Join the room on your phone (same Room ID as Host)
7. Wait for the Host to start a song!

</details>

<details>
<summary><strong>How It Works</strong></summary>

ODP+ uses **WebRTC** (via [PeerJS](https://peerjs.com)) for direct peer-to-peer connections.

1. **Host** connects to JDN normally and starts a room
2. **Followers** connect to the Host via WebRTC instead of JDN
3. Host **relays game state** (song selection, timing) to Followers
4. **Clock sync** ensures all clients see the same video frame

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

</details>

<details>
<summary><strong>Performance & Comparison</strong></summary>

### vs. Original Extension

| Feature | ODP+ | Original |
|---------|------|----------|
| Server Required | **No (P2P)** | Yes (free public server available, self-hosting preferred) |
| Cost | **Free** | Free (public) or hosting costs (self-hosted) |
| Latency | **Low** | Higher (relay hop) |
| Resilience | **Auto-Reconnect** | Manual |

### Performance Limits

| Scenario | Players | Host Upload | Status |
|----------|---------|-------------|--------|
| Small Party | 1-10 | < 1 Mbps | ✨ Perfect |
| Classroom | 10-50 | 2-8 Mbps | ✅ Good |
| Streamer | 50-100 | 10-20 Mbps | ⚠️ Risky |
| Massive Event | 200+ | > 50 Mbps | 🛑 Not Recommended |

</details>

<details>
<summary><strong>Supported Sites</strong></summary>

| Site | Status |
|------|--------|
| [justdancenow.com](https://justdancenow.com) | ✅ Supported |
| [justdancenowplus.ru](https://justdancenowplus.ru) | ⚠️ Partial |

**JustDanceNow+ Compatibility:**
- ✅ OurUI (2024), 2024, 2020, Experiments
- ❌ 2018, 2017, 2015

> ⚠️ **Maintenance Notice**: This extension is provided as-is. Future updates may break compatibility.

</details>

---

## Development

```bash
npm install        # Install dependencies
npm run build      # Build for production
npm start          # Run in Firefox (dev mode)
npm run startC     # Run in Chrome (dev mode)
```

---

## License

[AGPL-3.0](LICENSE) — See LICENSE file for details.

## Credits

- Based on [Online Dance Party](https://codeberg.org/ODP)
- Uses [PeerJS](https://peerjs.com) for WebRTC signaling
