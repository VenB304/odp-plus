# ODP+ — Dance Together Online! 🕺💃

**Play Just Dance Now with your friends, no matter where they are!**

<video src="https://github.com/user-attachments/assets/f93507ca-6521-47fc-a204-4c9c1094b4cc" controls width="100%"></video>

---

## What is ODP+?

ODP+ is a **free browser extension** that lets you play Just Dance Now together with friends online. Everyone sees the same dance moves at the same time — so you can dance together even if you're in different cities!

---

## What You Need

Before you start, make sure you have:

- ✅ A **computer** (Windows, Mac, or Linux)
- ✅ A **web browser** (Chrome, Edge, Firefox, or Brave)
- ✅ A **phone** to scan the Just Dance Now room code
- ✅ **Friends** who also installed ODP+ 🎉

---

## Installation (Easy Setup!)

### 📦 Option 1: Download Pre-built Release (Recommended)

**This is the easiest way for most users!**

1. Go to the [**Releases page**](https://github.com/VenB304/odp-plus/releases/latest)
2. Download the latest `odp-plus-x.x.x.zip` file
3. **Unzip** the downloaded file
4. **Add to your browser** (see instructions below)

### 🔨 Option 2: Build from Source

**For developers or if you want the latest changes:**

<details>
<summary>Click to expand build instructions</summary>

#### For Windows Users

1. **Download** this project (green "Code" button → "Download ZIP") and unzip it
2. **Double-click** `INSTALL.bat`
3. **Follow the on-screen instructions** — it does everything for you!
4. **Add to your browser** (the script will guide you)

> 💡 **Tip**: If you see a Windows security warning, click "More info" → "Run anyway"

#### For Other Platforms

See [docs/TECHNICAL.md](docs/TECHNICAL.md) for full build instructions.

</details>

### Adding to Chrome/Edge/Brave

1. Open your browser and go to `chrome://extensions` (or `edge://extensions`)
2. Turn **ON** "Developer mode" (toggle in the top right)
3. Click **"Load unpacked"**
4. Select the **unzipped folder** (it contains the `manifest.json` file)

### Adding to Firefox

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`
2. Click **"Load Temporary Add-on"**
3. Navigate to the **unzipped folder** and select `manifest.json`

> ⚠️ **Note**: Firefox extensions loaded this way are temporary and will be removed when you close Firefox. For a permanent installation, consider using Chrome/Edge/Brave.

---

## How to Play

### 🎤 If You're the Host

1. Go to [justdancenow.com](https://justdancenow.com)
2. **Start a Dance Room** on the website
3. Click the **ODP+ icon** in your browser (puzzle piece area)
4. Select **"Host a Party"** → Click **Apply**
5. **Share your Room ID** with your friends!
6. Join the room on your **phone** using the same Room ID
7. Wait for everyone to join, then pick a song!

### 🎵 If You're Joining

1. Go to [justdancenow.com](https://justdancenow.com)
2. Click the **ODP+ icon** in your browser
3. Select **"Join a Party"**
4. Enter the **Room ID** your friend sent you
5. Click **Apply**
6. Join the room on your **phone** using the **same Room ID as the host**
7. Wait for the host to start a song!

---

## Common Problems & Fixes

| Problem | What to Do |
|---------|------------|
| 📱 **Phone says "Room not found"** | You might need a VPN to match the host's country. The website uses region locks. |
| 🎥 **Video is out of sync** | Ask the host to use a wired internet connection instead of WiFi |
| 🔌 **Can't connect to host** | Try using your phone's hotspot as internet, or check if your network blocks peer connections |
| ⏳ **Joined late and stuck in lobby** | This is normal! Wait for the current song to finish, then you'll sync for the next one |
| 🎬 **JDNP video won't start / freezes** | Open ODP+ popup → expand "JDNP Video CDN" → try "Auto" or switch CDN manually |
| ❌ **INSTALL.bat doesn't work** | Make sure you have internet. If Node.js fails to install, download it manually from [nodejs.org](https://nodejs.org) |

---

## Supported Sites

| Site | Works? |
|------|--------|
| [justdancenow.com](https://justdancenow.com) | ✅ Yes! |
| [justdancenowplus.ru](https://justdancenowplus.ru) | ⚠️ Some versions only (OurUI, 2024, 2020, Experiments) |

> **JDNP users:** If video fails to load or freezes mid-song, try changing the CDN setting in the ODP+ popup. See [docs/TECHNICAL.md](docs/TECHNICAL.md#jdnp-cdn-override) for details.

---

## For Developers

Looking for technical details, build commands, or want to contribute?

👉 Check out [docs/TECHNICAL.md](docs/TECHNICAL.md)

---

## Credits

- Based on the original implementation, [Online Dance Party](https://codeberg.org/ODP).

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL%203.0-blue.svg)](LICENSE)
