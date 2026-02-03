# ODP+ - Serverless P2P

**Play Just Dance Now with friends anywhere, using a direct Peer-to-Peer connection.**

ODP+ is a serverless implementation of the original [Online Dance Party](https://codeberg.org/ODP) extension. It enables synchronization of Just Dance Now sessions between clients using a direct peer-to-peer connection.

## Features

*   **Serverless Architecture**: Connects directly via WebRTC (PeerJS).
*   **Host a Party**: One client acts as the Host.
*   **Join a Party**: Other clients connect using the Host's Room ID.
*   **Synchronized Playback**: Implements clock synchronization and state replay to align gameplay across devices.

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
4.  Select **"Host a Party"** and click **Apply**.
5.  **Share your Room ID** with your friends.
6.  Join the room on your phone (using the same Room ID).
7.  Wait for your friends to join the room.
8.  Start a song.

### As a Follower
1.  Open [Just Dance Now](https://justdancenow.com) (or JDN+).
2.  Click the **ODP+ Extension Icon**.
3.  Select **"Join a Party"**.
4.  Enter the **Room ID** provided by the Host.
5.  Click **Apply**.
6.  Join the room on your phone (using the same Room ID).
7.  Wait for the Host to start a song!

## Troubleshooting

*   **Reload Loop**: If the page reloads repeatedly, ensure you have the latest version.
*   **Sync Issues**: Playback is synchronized using control signals. Poor connection quality on the Host's side may affect signal delivery, potentially causing pauses or skips on Follower devices.

## Development

### Building from Source

```bash
# Install dependencies
npm install

# Build for production
npm run build
```

The compiled extension will be in the `dist` folder.

## Future Roadmap
- **JDN+ Support**: Investigating compatibility with [justdancenowplus.ru](https://justdancenowplus.ru).
- **Dynamic Asset Injection**: Support for custom asset paths.

## Credits

Based on the original [Online Dance Party](https://codeberg.org/ODP) concept.
