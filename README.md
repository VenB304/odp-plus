# Online Dance Party Plus

<!-- TODO: Add screenshot or GIF demo here -->
![Demo Video](https://github.com/user-attachments/assets/57895c9e-a833-4cb4-a6fd-87a94c0c1676)

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL%203.0-blue.svg)](LICENSE)

**Play Just Dance Now with friends anywhere, using a direct Peer-to-Peer connection.**

ODP+ is a serverless implementation of the original [Online Dance Party](https://codeberg.org/ODP) extension. It enables synchronization of Just Dance Now sessions between clients using WebRTC.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Features](#features)
- [Installation](#installation)
- [How to Play](#how-to-play)
- [How It Works](#how-it-works)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [License](#license)
- [Credits](#credits)

---

## Quick Start

1. **Install** the extension (see [Installation](#installation))
2. **Host**:
    - Open JDN
    - Start a room
    - Click ODP+ icon
    - Select "Host"
    - Click Apply
    - Share Room ID with Followers
3. **Join**:
    - Open JDN
    - Click ODP+ icon
    - Select "Join"
    - Enter Room ID
    - Click Apply

---

## Features

- **Serverless Architecture**: Connects directly via WebRTC (PeerJS) – no relay server needed.
- **Host a Party**: One client acts as the Host, sharing their Room ID.
- **Join a Party**: Other clients connect using the Host's Room ID.
- **Synchronized Playback**: Clock synchronization and state replay align gameplay across devices.
- **Region Lock Detection**: Warns you if you and the Host are in different regions (VPN may be required).

---

## Supported Sites

| Site | Status | Notes |
|------|--------|-------|
| [justdancenow.com](https://justdancenow.com) | ✅ Supported | Official JDN site |
| [justdancenowplus.ru](https://justdancenowplus.ru) | ⚠️ Partial | See below |

### JustDanceNow+ Compatibility

| UI Version | Status |
|------------|--------|
| OurUI (2024) | ✅ Works |
| 2024 | ✅ Works |
| 2020 | ✅ Works |
| Experiments | ✅ Works |
| 2018 | ❌ Not Supported |
| 2017 | ❌ Not Supported |
| 2015 | ❌ Not Supported |

> ⚠️ **Maintenance Notice**: This extension is provided as-is. Future updates to Just Dance Now or JustDanceNow+ may break compatibility. There is no guarantee of ongoing maintenance or updates.

---

## Installation

### Chrome / Edge / Brave

1. Download the latest release from [Releases](https://github.com/VenB304/odp-plus/releases).
2. Unzip the folder.
3. Go to `chrome://extensions`.
4. Enable **Developer Mode** (top right).
5. Click **Load unpacked** and select the `dist` folder.

### Firefox

1. Download the latest release.
2. Go to `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on**.
4. Select the `manifest.json` file in the `dist` folder.

---

## How to Play

### As a Host

1. Open [Just Dance Now](https://justdancenow.com).
2. Start a Dance Room.
3. Click the **ODP+ Extension Icon**.
4. Select **"Host a Party"** and click **Apply**.
5. **Share your Room ID** with your friends.
6. Join the room on your phone (using the same Room ID).
7. Wait for your friends to join.
8. Start a song!

### As a Follower

1. Open [Just Dance Now](https://justdancenow.com).
2. Click the **ODP+ Extension Icon**.
3. Select **"Join a Party"**.
4. Enter the **Room ID** provided by the Host.
5. Click **Apply**.
6. Join the room on your phone (using the **same Room ID as the Host**).
7. Wait for the Host to start a song!

> ⚠️ **Region Lock Warning**: If you and the Host are in different countries, you may get a "Room Not Found" error when joining with your phone. Use a VPN to connect to the same region as the Host.

---

## How It Works

ODP+ uses **WebRTC** (via [PeerJS](https://peerjs.com)) to establish a direct peer-to-peer connection between the Host and Followers.

1. **Host** connects to the JDN server normally and starts a room.
2. **Followers** connect to the Host via WebRTC instead of the JDN server.
3. The Host **relays game state** (song selection, playback timing) to Followers.
4. **Clock synchronization** ensures all clients see the same video frame at the same time.

This means:
- No central server is needed (besides PeerJS signaling).
- Latency depends on the connection quality between you and the Host.
- The Host's internet connection is critical for a smooth experience.

---

## Troubleshooting

| Problem | Cause | Solution |
|---------|-------|----------|
| **Page reloads repeatedly** | Outdated extension | Update to the latest version |
| **"Room Not Found" on phone** | Region mismatch | Use a VPN to match the Host's region before joining |
| **Video out of sync** | Poor Host connection | Host should use a wired connection and close bandwidth-heavy apps |
| **Can't connect to Host** | NAT/Firewall blocking WebRTC | Try a mobile hotspot, disable VPN if blocking WebRTC, or ask network admin to allow UDP traffic |
| **Connection drops** | PeerJS signaling issue | Refresh both Host and Follower pages, wait a few minutes and retry |
| **Late joiner stuck in lobby** | Joined mid-song | This is expected behavior. Late joiners wait until the current song ends before syncing. |

---

## Development

### Building from Source

```bash
# Install dependencies
npm install

# Build for production
npm run build

# Run in Firefox (dev mode)
npm start

# Run in Chrome (dev mode)
npm run startC
```

The compiled extension will be in the `dist` folder.

---

## License

This project is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.

See [LICENSE](LICENSE) for the full text.

---

## Credits

- Based on the original [Online Dance Party](https://codeberg.org/ODP) concept.
- Uses [PeerJS](https://peerjs.com) for WebRTC signaling.
