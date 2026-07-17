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
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // STEP 1: Override play() IMMEDIATELY — this runs at document_start
  //         before YouTube's scripts even load
  // ═══════════════════════════════════════════════════════════════

  const originalPlay = HTMLMediaElement.prototype.play;
  const originalLoad = HTMLMediaElement.prototype.load;

  HTMLMediaElement.prototype.play = function () {
    if (isWhitelisted()) return originalPlay.apply(this, arguments);
    if (this.__shutUpUserActivated) return originalPlay.apply(this, arguments);
    if (userClickedPlay) {
      this.__shutUpUserActivated = true;
      userClickedPlay = false;
      return originalPlay.apply(this, arguments);
    }
    if (navigator.userActivation && navigator.userActivation.isActive) {
      this.__shutUpUserActivated = true;
      return originalPlay.apply(this, arguments);
    }

    // BLOCK — also prevent buffering
    this.preload = "none";
    notifyBlocked();

    try { this.pause(); } catch (e) {}
    return Promise.resolve();
  };

  // ═══════════════════════════════════════════════════════════════
  // STEP 2: Prevent video elements from loading src at all
  //         Override the src setter on HTMLMediaElement
  // ═══════════════════════════════════════════════════════════════

  const isYouTube = location.hostname === "www.youtube.com" ||
                    location.hostname === "youtube.com" ||
                    location.hostname === "m.youtube.com";

  let blockSrcAssignment = isYouTube; // Start blocking on YT until user clicks

  const srcDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src");
  if (srcDescriptor && srcDescriptor.set) {
    const originalSrcSet = srcDescriptor.set;
    const originalSrcGet = srcDescriptor.get;

    Object.defineProperty(HTMLMediaElement.prototype, "src", {
      get: function () { return originalSrcGet.call(this); },
      set: function (val) {
        if (isWhitelisted() || this.__shutUpUserActivated) {
          return originalSrcSet.call(this, val);
        }
        if (blockSrcAssignment) {
          // Store it but don't set it — we'll use it when user clicks play
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
        if (isWhitelisted() || this.__shutUpUserActivated) {
          return originalSrcObjSet.call(this, val);
        }
        if (blockSrcAssignment) {
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
      // Remove overlay
      const overlay = document.querySelector(".shutup-overlay");
      if (overlay) overlay.remove();

      // Unblock src assignment
      blockSrcAssignment = false;
      userClickedPlay = true;

      // Find the video element and activate it
      const video = document.querySelector("#movie_player video, video");
      if (video) {
        video.__shutUpUserActivated = true;

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
          originalPlay.call(video).catch(function () {});
        }, { once: true });

        // Also try playing after a short delay as fallback
        setTimeout(function () {
          originalPlay.call(video).catch(function () {});
        }, 300);
      }

      // Click YouTube's native play button to let YT's own player re-init properly
      var clickYtPlay = function () {
        const vid = document.querySelector("#movie_player video, video");
        // Don't click if already playing
        if (vid && !vid.paused) return;
        const ytBtn = document.querySelector(".ytp-play-button");
        if (ytBtn) {
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

      // Find the player container
      const playerContainer = document.querySelector("#movie_player") ||
                              document.querySelector("ytd-player") ||
                              document.querySelector("#player-container-outer") ||
                              document.querySelector("#player");
      if (!playerContainer) return;

      // Already installed?
      if (playerContainer.querySelector("[data-shutup-overlay]")) return;

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
        try {
          video.pause();
          // Don't remove src — just block it from being set via our override
        } catch (e) {}
      }
    }

    // Watch for YouTube SPA navigation
    let lastUrl = location.href;

    function onNavigate() {
      if (location.href === lastUrl) return;
      lastUrl = location.href;

      // Reset state for new video
      blockSrcAssignment = true;
      userClickedPlay = false;

      // Remove old overlay
      const old = document.querySelector("[data-shutup-overlay]");
      if (old) old.remove();

      // IMMEDIATELY pause and reset all video elements — this prevents
      // the video from playing underneath the overlay during SPA navigation
      document.querySelectorAll("video").forEach(function (v) {
        v.__shutUpUserActivated = false;
        try {
          v.pause();
          // Wipe the src so it stops buffering/playing entirely
          // Store current src in case we need it later
          if (v.src) {
            v.__shutUpPendingSrc = v.src;
          }
          if (srcDescriptor && srcDescriptor.set) {
            // Use original setter to clear
            srcDescriptor.set.call(v, "");
          }
          if (v.srcObject) {
            v.__shutUpPendingSrcObj = v.srcObject;
            if (srcObjDescriptor && srcObjDescriptor.set) {
              srcObjDescriptor.set.call(v, null);
            }
          }
          v.removeAttribute("src");
          v.load(); // Force the empty state
        } catch (e) {}
      });

      // Install new overlay (with retries since YT loads async)
      installOverlay();
      setTimeout(installOverlay, 100);
      setTimeout(installOverlay, 500);
      setTimeout(installOverlay, 1200);
      setTimeout(installOverlay, 3000);
    }

    // Hook history API
    const origPushState = history.pushState;
    const origReplaceState = history.replaceState;
    history.pushState = function () {
      origPushState.apply(this, arguments);
      setTimeout(onNavigate, 50);
    };
    history.replaceState = function () {
      origReplaceState.apply(this, arguments);
      setTimeout(onNavigate, 50);
    };
    window.addEventListener("popstate", function () { setTimeout(onNavigate, 50); });

    // Extra safety: catch any video that starts playing when it shouldn't
    // This handles the race where YT's player fires play before our overlay is ready
    document.addEventListener("playing", function (e) {
      if (userClickedPlay || isWhitelisted()) return;
      const video = e.target;
      if (video && video.tagName === "VIDEO" && !video.__shutUpUserActivated) {
        // Only intervene for the main player, not thumbnail previews
        const inPlayer = video.closest("#movie_player, ytd-player, #player-container-outer");
        if (inPlayer) {
          try { video.pause(); } catch (err) {}
        }
      }
    }, true);

    // MutationObserver to catch the player appearing
    function startObserving() {
      const obs = new MutationObserver(function () {
        if (location.pathname.startsWith("/watch") || location.pathname.startsWith("/shorts")) {
          const player = document.querySelector("#movie_player");
          if (player && !player.querySelector("[data-shutup-overlay]") && !userClickedPlay) {
            installOverlay();

            // Also ensure video is paused if overlay just got installed
            // This handles the race where YT starts playing during SPA nav
            const video = player.querySelector("video");
            if (video && !video.paused && !video.__shutUpUserActivated) {
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
      installOverlay();
      startObserving();
      // Retries for initial page load
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
