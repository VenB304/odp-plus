# ODP+ (Serverless P2P Edition)

**Play Just Dance Now with friends anywhere, using a direct Peer-to-Peer connection.**

ODP+ is a modernized, serverless version of the original Online Dance Party extension. It allows you to sync your Just Dance Now screen with friends over the internet without relying on any central game server.

## Features

*   **100% Serverless**: Connects directly via WebRTC (PeerJS). No more "Server Unavailable" errors.
*   **Host a Party**: One person acts as the Host.
*   **Join a Party**: Friends join using the Host's Room ID.
*   **Perfect Sync**: Automatic clock synchronization and state replay ensures everyone sees the same move at the same time.
*   **Privacy Focused**: No gameplay data is sent to third-party ODP servers.

## Installation

### Chrome / Edge / Brave

1.  Download the latest release.
2.  Unzip the folder.
3.  Go to `chrome://extensions`.
4.  Enable **Developer Mode** (top right).
5.  Click **Load unpacked** and select the `dist` folder.

### Firefox

1.  Download the latest release.
2.  Go to `about:debugging#/runtime/this-firefox`.
3.  Click **Load Temporary Add-on**.
4.  Select the `manifest.json` file in the `dist` folder.

## How to Play

### As a Host
1.  Open [Just Dance Now](https://justdancenow.com) (or JDN+).
2.  Start a Dance Room.
3.  Click the **ODP+ Extension Icon**.
4.  Select **"Host a Party"** and click **Update Settings**.
5.  **Share your Room ID** with your friends.

### As a Follower
1.  Open [Just Dance Now](https://justdancenow.com) (or JDN+).
2.  Click the **ODP+ Extension Icon**.
3.  Select **"Join a Party"**.
4.  Enter the **Room ID** provided by the Host.
5.  Click **Update Settings**.
6.  Join the room on your phone (using the same Room ID).
7.  Wait for the Host to start a song!

## Troubleshooting

*   **Reload Loop?**: If the page keeps reloading, ensure you have the latest version. We fixed a major issue where JDN servers disconnected silent followers.
*   **No Sync?**: Ensure both Host and Follower are on the same version of the extension.
*   **Sync Issues?**: The video plays directly from JDN servers on your device. However, if the Host has a poor internet connection, the "Start/Stop" signals might misfire, causing your game to pause or jump to catch up.

## Development

### Building from Source

```bash
# Install dependencies
npm install

# Build for production
npm run build
```

The compiled extension will be in the `dist` folder.

## Credits

Based on the original [Online Dance Party](https://codeberg.org/ODP) concept.
