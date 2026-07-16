# 🔇 Shut Up (No Autoplay)

A Chrome extension that blocks all autoplay. Nothing plays unless you click it.

Your machine, your rules.

## What it does

- **YouTube**: Replaces the video player with a maxres thumbnail. Zero bytes of video are downloaded until you click play.
- **All other sites**: Blocks `play()` calls unless triggered by a real user gesture. Also sets `preload="none"` to prevent buffering.

## Features

- Manifest V3 (modern, no deprecated APIs)
- Intercepts `play()`, `src`, and `srcObject` at the prototype level — catches everything
- Trusted Types compliant (works on YouTube's strict CSP)
- Per-site whitelist via popup toggle
- Badge counter showing blocked autoplay attempts per tab
- Works in iframes (ads, embeds)
- Handles YouTube's SPA navigation (no page reloads between videos)
- Kills homepage video preview hover-autoplay on YouTube

## Install

1. Clone this repo (or download as ZIP)
2. Open `chrome://extensions/`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked**
5. Select the `shut-up-extension` folder

## Usage

Just browse. Videos won't play until you click them.

**On YouTube**: You'll see the video thumbnail with a play button. Click it once to start the video.

**Whitelist a site**: Click the extension icon in the toolbar, then toggle the switch to allow autoplay on the current site.

## How it works

The extension injects a content script into the page's **main world** (same JS context as the page itself) at `document_start` — before any other scripts run. It overrides:

1. `HTMLMediaElement.prototype.play()` — blocks unless `navigator.userActivation.isActive`
2. `HTMLMediaElement.prototype.src` setter — prevents video source assignment on YouTube until user clicks
3. `HTMLMediaElement.prototype.srcObject` setter — same, for MediaSource-based players

On YouTube specifically, it overlays the player with a thumbnail image and custom play button. When clicked, it restores the captured source and lets YouTube's native player take over.

## Files

```
manifest.json          — Extension manifest (MV3)
content-main.js        — Main world script (play/src/srcObject interception + YT overlay)
content-isolated.js    — Isolated world script (bridge to background, whitelist state)
background.js          — Service worker (badge count, whitelist storage)
popup.html             — Extension popup UI
popup.js               — Popup logic
icons/                 — Extension icons
```

## License

MIT
