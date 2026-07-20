/**
 * content-main.js — Runs in the MAIN world at document_start.
 *
 * AGGRESSIVE approach:
 * 1. Override play() immediately (before any other script runs)
 * 2. Override createElement to neuter video elements at birth
 * 3. On YouTube: replace player with thumbnail, zero network requests for video
 * 4. On other sites: block play() unless user-initiated
 */
(function () {
  "use strict";

  if (window.__shutUpAutoplayInstalled) return;
  window.__shutUpAutoplayInstalled = true;

  let blockedCount = 0;
  let userClickedPlay = false;

  // ═══════════════════════════════════════════════════════════════
  // Detect YouTube early — needed by the play() override below
  // ═══════════════════════════════════════════════════════════════

  const isYouTube = location.hostname === "www.youtube.com" ||
                    location.hostname === "youtube.com" ||
                    location.hostname === "m.youtube.com";

  // Track which URL the user last clicked play on — used to invalidate
  // __shutUpUserActivated when YouTube navigates to a new video
  let activatedForUrl = isYouTube ? "" : location.href;

  console.log("shutup: initialized", { isYouTube, activatedForUrl, href: location.href });

  function notifyBlocked() {
    blockedCount++;
    window.postMessage({ type: "__shutup_blocked", count: blockedCount }, "*");
  }

  function isWhitelisted() {
    return window.__shutUpWhitelisted === true;
  }

  // Listen for whitelist messages from isolated world
  window.addEventListener("message", function (e) {
    if (e.data && e.data.type === "__shutup_whitelist") {
      window.__shutUpWhitelisted = !!e.data.whitelisted;
      console.log("shutup: whitelist message received", { whitelisted: e.data.whitelisted });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // STEP 1: Override play() IMMEDIATELY — this runs at document_start
  //         before YouTube's scripts even load
  // ═══════════════════════════════════════════════════════════════

  const originalPlay = HTMLMediaElement.prototype.play;
  const originalLoad = HTMLMediaElement.prototype.load;

  HTMLMediaElement.prototype.play = function () {
    const tag = this.id || this.className || this.tagName;
    const inPlayer = this.closest && this.closest("#movie_player, ytd-player, #player-container-outer");

    if (isWhitelisted()) {
      console.log("shutup: play() ALLOWED — whitelisted", { tag });
      return originalPlay.apply(this, arguments);
    }

    // On YouTube: hard gate.
    if (isYouTube) {
      if (userClickedPlay) {
        console.log("shutup: play() ALLOWED — userClickedPlay=true", { tag, href: location.href });
        this.__shutUpUserActivated = true;
        activatedForUrl = location.href;
        userClickedPlay = false;
        return originalPlay.apply(this, arguments);
      }
      if (this.__shutUpUserActivated) {
        const overlayPresent = !!document.querySelector("[data-shutup-overlay]");
        const urlMismatch = location.href !== activatedForUrl;
        if (urlMismatch || overlayPresent) {
          console.log("shutup: play() BLOCKED — stale activation", { tag, urlMismatch, overlayPresent, activatedForUrl, href: location.href });
          this.__shutUpUserActivated = false;
          this.preload = "none";
          notifyBlocked();
          try { this.pause(); } catch (e) {}
          return Promise.resolve();
        }
        console.log("shutup: play() ALLOWED — __shutUpUserActivated valid", { tag, activatedForUrl });
        return originalPlay.apply(this, arguments);
      }
      console.log("shutup: play() BLOCKED — no activation on YT", { tag, inPlayer: !!inPlayer, href: location.href });
      this.preload = "none";
      notifyBlocked();
      try { this.pause(); } catch (e) {}
      return Promise.resolve();
    }

    // Non-YouTube sites
    if (this.__shutUpUserActivated) {
      console.log("shutup: play() ALLOWED — __shutUpUserActivated (non-YT)", { tag });
      return originalPlay.apply(this, arguments);
    }
    if (userClickedPlay) {
      console.log("shutup: play() ALLOWED — userClickedPlay (non-YT)", { tag });
      this.__shutUpUserActivated = true;
      userClickedPlay = false;
      return originalPlay.apply(this, arguments);
    }
    if (navigator.userActivation && navigator.userActivation.isActive) {
      console.log("shutup: play() ALLOWED — userActivation.isActive (non-YT)", { tag });
      this.__shutUpUserActivated = true;
      return originalPlay.apply(this, arguments);
    }

    console.log("shutup: play() BLOCKED (non-YT)", { tag });
    this.preload = "none";
    notifyBlocked();
    try { this.pause(); } catch (e) {}
    return Promise.resolve();
  };

  // ═══════════════════════════════════════════════════════════════
  // STEP 2: Prevent video elements from loading src at all
  //         Override the src setter on HTMLMediaElement
  // ═══════════════════════════════════════════════════════════════

  let blockSrcAssignment = isYouTube; // Start blocking on YT until user clicks

  const srcDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src");
  if (srcDescriptor && srcDescriptor.set) {
    const originalSrcSet = srcDescriptor.set;
    const originalSrcGet = srcDescriptor.get;

    Object.defineProperty(HTMLMediaElement.prototype, "src", {
      get: function () { return originalSrcGet.call(this); },
      set: function (val) {
        if (isWhitelisted()) return originalSrcSet.call(this, val);
        if (isYouTube) {
          const overlayPresent = !!document.querySelector("[data-shutup-overlay]");
          const urlMismatch = location.href !== activatedForUrl;
          if (overlayPresent || urlMismatch) {
            console.log("shutup: src setter BLOCKED (YT overlay/url)", { overlayPresent, urlMismatch, val: val && val.substring(0, 80) });
            this.__shutUpPendingSrc = val;
            return;
          }
        }
        if (this.__shutUpUserActivated) {
          return originalSrcSet.call(this, val);
        }
        if (blockSrcAssignment) {
          console.log("shutup: src setter BLOCKED (blockSrcAssignment)", { val: val && val.substring(0, 80) });
          this.__shutUpPendingSrc = val;
          return;
        }
        return originalSrcSet.call(this, val);
      },
      configurable: true,
      enumerable: true,
    });
  }

  // Also block srcObject (MediaSource based players like YouTube)
  const srcObjDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "srcObject");
  if (srcObjDescriptor && srcObjDescriptor.set) {
    const originalSrcObjSet = srcObjDescriptor.set;
    const originalSrcObjGet = srcObjDescriptor.get;

    Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
      get: function () { return originalSrcObjGet.call(this); },
      set: function (val) {
        if (isWhitelisted()) return originalSrcObjSet.call(this, val);
        if (isYouTube) {
          const overlayPresent = !!document.querySelector("[data-shutup-overlay]");
          const urlMismatch = location.href !== activatedForUrl;
          if (overlayPresent || urlMismatch) {
            console.log("shutup: srcObject setter BLOCKED (YT overlay/url)", { overlayPresent, urlMismatch, val: val ? "MediaSource" : "null" });
            this.__shutUpPendingSrcObj = val;
            return;
          }
        }
        if (this.__shutUpUserActivated) {
          return originalSrcObjSet.call(this, val);
        }
        if (blockSrcAssignment) {
          console.log("shutup: srcObject setter BLOCKED (blockSrcAssignment)", { val: val ? "MediaSource" : "null" });
          this.__shutUpPendingSrcObj = val;
          return;
        }
        return originalSrcObjSet.call(this, val);
      },
      configurable: true,
      enumerable: true,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 3: YouTube-specific thumbnail overlay
  // ═══════════════════════════════════════════════════════════════

  if (isYouTube) {
    function getVideoId(url) {
      try {
        const u = new URL(url || location.href);
        if (u.searchParams.has("v")) return u.searchParams.get("v");
        // /shorts/ID or /embed/ID
        const parts = u.pathname.split("/").filter(Boolean);
        if (parts.length >= 2) return parts[parts.length - 1];
        return null;
      } catch (e) { return null; }
    }

    function injectStyles() {
      if (document.querySelector("#shutup-styles")) return;
      const style = document.createElement("style");
      style.id = "shutup-styles";
      style.textContent = `
        .shutup-overlay {
          position: absolute;
          top: 0; left: 0; width: 100%; height: 100%;
          z-index: 99999;
          background: #000;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }
        .shutup-overlay img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          position: absolute;
          top: 0; left: 0;
        }
        .shutup-overlay .shutup-play-btn {
          position: relative;
          z-index: 2;
          background: rgba(0,0,0,0.7);
          border: none;
          border-radius: 14px;
          padding: 16px 24px;
          cursor: pointer;
          transition: background 0.15s, transform 0.15s;
        }
        .shutup-overlay .shutup-play-btn:hover {
          background: rgba(204,0,0,0.9);
          transform: scale(1.05);
        }
        .shutup-overlay .shutup-play-btn svg {
          display: block;
        }
      `;
      (document.head || document.documentElement).appendChild(style);
    }

    function createOverlay(videoId) {
      const overlay = document.createElement("div");
      overlay.className = "shutup-overlay";
      overlay.dataset.shutupOverlay = "true";

      // Thumbnail image (no innerHTML — Trusted Types safe)
      const img = document.createElement("img");
      img.src = "https://i.ytimg.com/vi/" + videoId + "/maxresdefault.jpg";
      img.alt = "";
      img.addEventListener("error", function () {
        img.src = "https://i.ytimg.com/vi/" + videoId + "/hqdefault.jpg";
      }, { once: true });
      overlay.appendChild(img);

      // Play button
      const btn = document.createElement("button");
      btn.className = "shutup-play-btn";
      btn.setAttribute("aria-label", "Play video");

      // SVG play icon (built via DOM namespace APIs)
      const svgNS = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(svgNS, "svg");
      svg.setAttribute("width", "68");
      svg.setAttribute("height", "48");
      svg.setAttribute("viewBox", "0 0 68 48");

      const bgPath = document.createElementNS(svgNS, "path");
      bgPath.setAttribute("d", "M66.52 7.74c-.78-2.93-2.49-5.41-5.42-6.19C55.79.13 34 0 34 0S12.21.13 6.9 1.55c-2.93.78-4.64 3.26-5.42 6.19C.06 13.05 0 24 0 24s.06 10.95 1.48 16.26c.78 2.93 2.49 5.41 5.42 6.19C12.21 47.87 34 48 34 48s21.79-.13 27.1-1.55c2.93-.78 4.64-3.26 5.42-6.19C67.94 34.95 68 24 68 24s-.06-10.95-1.48-16.26z");
      bgPath.setAttribute("fill", "#CC0000");
      svg.appendChild(bgPath);

      const arrowPath = document.createElementNS(svgNS, "path");
      arrowPath.setAttribute("d", "M45 24L27 14v20");
      arrowPath.setAttribute("fill", "#fff");
      svg.appendChild(arrowPath);

      btn.appendChild(svg);
      overlay.appendChild(btn);

      return overlay;
    }

    function activatePlayer() {
      console.log("shutup: activatePlayer() called", { href: location.href });

      // Remove overlay
      const overlay = document.querySelector(".shutup-overlay");
      if (overlay) overlay.remove();

      // Unblock src assignment
      blockSrcAssignment = false;
      userClickedPlay = true;
      activatedForUrl = location.href;

      console.log("shutup: overlay removed, activatedForUrl set", { activatedForUrl });

      // Find the video element and activate it
      const video = document.querySelector("#movie_player video, video");
      if (video) {
        video.__shutUpUserActivated = true;

        console.log("shutup: video found, restoring sources", {
          hasPendingSrcObj: !!video.__shutUpPendingSrcObj,
          hasPendingSrc: !!video.__shutUpPendingSrc
        });

        // If we captured a pending srcObject, set it now
        if (video.__shutUpPendingSrcObj) {
          const origSet = srcObjDescriptor ? srcObjDescriptor.set : null;
          if (origSet) origSet.call(video, video.__shutUpPendingSrcObj);
          video.__shutUpPendingSrcObj = null;
        }
        if (video.__shutUpPendingSrc) {
          const origSet = srcDescriptor ? srcDescriptor.set : null;
          if (origSet) origSet.call(video, video.__shutUpPendingSrc);
          video.__shutUpPendingSrc = null;
        }

        // Load the source, then play when ready
        originalLoad.call(video);

        // Wait for enough data to play
        video.addEventListener("canplay", function () {
          console.log("shutup: canplay fired, calling originalPlay");
          originalPlay.call(video).catch(function () {});
        }, { once: true });

        // Also try playing after a short delay as fallback
        setTimeout(function () {
          console.log("shutup: fallback play timeout fired");
          originalPlay.call(video).catch(function () {});
        }, 300);
      } else {
        console.log("shutup: no video element found in activatePlayer!");
      }

      // Click YouTube's native play button to let YT's own player re-init properly
      var clickYtPlay = function () {
        // Abort if overlay came back (shouldn't happen, but safety)
        if (document.querySelector("[data-shutup-overlay]")) return;
        const vid = document.querySelector("#movie_player video, video");
        // Don't click if already playing
        if (vid && !vid.paused) return;
        const ytBtn = document.querySelector(".ytp-play-button");
        if (ytBtn) {
          console.log("shutup: clicking YT native play button");
          ytBtn.click();
        }
      };
      setTimeout(clickYtPlay, 50);
      setTimeout(clickYtPlay, 200);
      setTimeout(clickYtPlay, 500);
      setTimeout(clickYtPlay, 1500);
    }

    function installOverlay() {
      if (!location.pathname.startsWith("/watch") && !location.pathname.startsWith("/shorts")) return;

      const videoId = getVideoId(location.href);
      if (!videoId) return;

      // Don't install overlay if user already activated playback for this URL
      if (activatedForUrl === location.href) {
        console.log("shutup: installOverlay() SKIPPED — URL matches activatedForUrl", { videoId, activatedForUrl });
        return;
      }

      // Find the player container
      const playerContainer = document.querySelector("#movie_player") ||
                              document.querySelector("ytd-player") ||
                              document.querySelector("#player-container-outer") ||
                              document.querySelector("#player");
      if (!playerContainer) return;

      // Already installed?
      if (playerContainer.querySelector("[data-shutup-overlay]")) return;

      console.log("shutup: installOverlay()", { videoId, href: location.href });

      injectStyles();

      // Make sure the container is positioned
      const pos = getComputedStyle(playerContainer).position;
      if (pos === "static") playerContainer.style.position = "relative";

      const overlay = createOverlay(videoId);
      playerContainer.appendChild(overlay);

      overlay.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        activatePlayer();
      });

      // Also kill any video that's already there
      const video = playerContainer.querySelector("video");
      if (video) {
        const wasPaused = video.paused;
        try {
          video.__shutUpUserActivated = false;
          video.pause();
          console.log("shutup: paused existing video in installOverlay", { wasPaused });
        } catch (e) {}
      }
    }

    // Watch for YouTube SPA navigation
    let lastUrl = location.href;

    function onNavigate() {
      if (location.href === lastUrl) return;
      console.log("shutup: onNavigate() — URL changed", { from: lastUrl, to: location.href });
      lastUrl = location.href;

      // Reset state for new video
      blockSrcAssignment = true;
      userClickedPlay = false;

      // Remove old overlay
      const old = document.querySelector("[data-shutup-overlay]");
      if (old) {
        old.remove();
        console.log("shutup: removed old overlay");
      }

      // IMMEDIATELY pause and reset all video elements
      document.querySelectorAll("video").forEach(function (v) {
        const wasPaused = v.paused;
        v.__shutUpUserActivated = false;
        try {
          v.pause();
          if (v.src) {
            v.__shutUpPendingSrc = v.src;
          }
          if (srcDescriptor && srcDescriptor.set) {
            srcDescriptor.set.call(v, "");
          }
          if (v.srcObject) {
            v.__shutUpPendingSrcObj = v.srcObject;
            if (srcObjDescriptor && srcObjDescriptor.set) {
              srcObjDescriptor.set.call(v, null);
            }
          }
          v.removeAttribute("src");
          v.load();
          console.log("shutup: reset video in onNavigate", { wasPaused });
        } catch (e) {}
      });

      // Install new overlay (with retries since YT loads async)
      installOverlay();
      setTimeout(installOverlay, 100);
      setTimeout(installOverlay, 500);
      setTimeout(installOverlay, 1200);
      setTimeout(installOverlay, 3000);
    }

    // Hook history API — call onNavigate SYNCHRONOUSLY
    const origPushState = history.pushState;
    const origReplaceState = history.replaceState;
    history.pushState = function () {
      console.log("shutup: history.pushState called", { url: arguments[2] });
      origPushState.apply(this, arguments);
      onNavigate();
    };
    history.replaceState = function () {
      console.log("shutup: history.replaceState called", { url: arguments[2] });
      origReplaceState.apply(this, arguments);
      onNavigate();
    };
    window.addEventListener("popstate", function () {
      console.log("shutup: popstate fired");
      onNavigate();
    });

    // YouTube fires its own navigation event
    document.addEventListener("yt-navigate-start", function () {
      console.log("shutup: yt-navigate-start fired", { href: location.href });
      onNavigate();
    });

    // BULLETPROOF: If the overlay is in the DOM and a video in the main player
    // fires "playing", it's unauthorized — kill it immediately.
    document.addEventListener("playing", function (e) {
      if (isWhitelisted()) return;
      // Don't interfere if user already activated this URL
      if (activatedForUrl === location.href) return;
      const video = e.target;
      if (!video || video.tagName !== "VIDEO") return;

      const overlay = document.querySelector("[data-shutup-overlay]");
      if (!overlay) return;

      const inPlayer = video.closest("#movie_player, ytd-player, #player-container-outer");
      if (!inPlayer) return;

      console.log("shutup: PLAYING event caught with overlay present — KILLING", {
        paused: video.paused,
        src: video.src && video.src.substring(0, 60),
        currentTime: video.currentTime
      });

      try {
        video.pause();
        video.__shutUpUserActivated = false;
        if (video.src) {
          video.__shutUpPendingSrc = video.src;
          if (srcDescriptor && srcDescriptor.set) {
            srcDescriptor.set.call(video, "");
          }
          video.removeAttribute("src");
          video.load();
        }
        if (video.srcObject) {
          video.__shutUpPendingSrcObj = video.srcObject;
          if (srcObjDescriptor && srcObjDescriptor.set) {
            srcObjDescriptor.set.call(video, null);
          }
        }
      } catch (err) {}
    }, true);

    // Backup: timeupdate fires continuously during playback
    let lastTimeupdateLog = 0;
    document.addEventListener("timeupdate", function (e) {
      if (isWhitelisted()) return;
      // Don't interfere if user already activated this URL
      if (activatedForUrl === location.href) return;
      const video = e.target;
      if (!video || video.tagName !== "VIDEO") return;

      const overlay = document.querySelector("[data-shutup-overlay]");
      if (!overlay) return;

      const inPlayer = video.closest("#movie_player, ytd-player, #player-container-outer");
      if (!inPlayer) return;

      const now = Date.now();
      if (now - lastTimeupdateLog > 500) {
        console.log("shutup: TIMEUPDATE caught with overlay present — pausing", { currentTime: video.currentTime });
        lastTimeupdateLog = now;
      }

      try {
        video.pause();
        video.__shutUpUserActivated = false;
      } catch (err) {}
    }, true);

    // MutationObserver to catch the player appearing
    function startObserving() {
      const obs = new MutationObserver(function () {
        if (location.pathname.startsWith("/watch") || location.pathname.startsWith("/shorts")) {
          const player = document.querySelector("#movie_player");
          if (player && !player.querySelector("[data-shutup-overlay]") && !userClickedPlay) {
            // Don't reinstall if the user already activated this URL
            if (activatedForUrl === location.href) {
              return;
            }
            console.log("shutup: MutationObserver — installing overlay (no overlay found, userClickedPlay=false)");
            installOverlay();

            const video = player.querySelector("video");
            if (video && !video.paused && !video.__shutUpUserActivated) {
              console.log("shutup: MutationObserver — pausing video after overlay install");
              try { video.pause(); } catch (e) {}
            }
          }
        }

        // Kill thumbnail preview videos (homepage hover previews)
        document.querySelectorAll("ytd-thumbnail video, #thumbnail video").forEach(function (v) {
          if (!v.__shutUpUserActivated) {
            try { v.pause(); } catch (e) {}
          }
        });
      });

      obs.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
      });
    }

    // Init
    function init() {
      console.log("shutup: init()", { pathname: location.pathname });
      installOverlay();
      startObserving();
      setTimeout(installOverlay, 200);
      setTimeout(installOverlay, 600);
      setTimeout(installOverlay, 1500);
    }

    if (document.body) {
      init();
    } else {
      document.addEventListener("DOMContentLoaded", init);
    }

    return;
  }

  // ═══════════════════════════════════════════════════════════════
  // ALL OTHER SITES: Generic blocking
  // ═══════════════════════════════════════════════════════════════

  // Strip autoplay and preload
  const observer = new MutationObserver(function (mutations) {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLMediaElement) {
          node.autoplay = false;
          node.removeAttribute("autoplay");
          node.preload = "none";
        }
        if (node.querySelectorAll) {
          node.querySelectorAll("video, audio").forEach(function (el) {
            el.autoplay = false;
            el.removeAttribute("autoplay");
            el.preload = "none";
          });
        }
      }
    }
  });

  if (document.documentElement) {
    observer.observe(document.documentElement, { childList: true, subtree: true });
  } else {
    document.addEventListener("DOMContentLoaded", function () {
      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
  }

  // Click-to-play for non-YouTube sites
  document.addEventListener("click", function (e) {
    const media = e.target.closest("video, audio");
    if (media) {
      media.__shutUpUserActivated = true;
      originalPlay.call(media);
    }
  }, true);
})();
