/**
 * content-isolated.js — Runs in the ISOLATED world.
 * Bridges between the main world script and the background service worker.
 * Uses window messaging (no script injection — avoids Trusted Types).
 */
(function () {
  "use strict";

  const hostname = location.hostname;

  // Check if current site is whitelisted and tell the main world script via postMessage
  chrome.storage.sync.get({ whitelist: [] }, function (data) {
    if (data.whitelist.includes(hostname)) {
      window.postMessage({ type: "__shutup_whitelist", whitelisted: true }, "*");
    }
  });

  // Listen for blocked events from the main world
  window.addEventListener("message", function (e) {
    if (e.data && e.data.type === "__shutup_blocked") {
      try {
        chrome.runtime.sendMessage({
          type: "blocked",
          count: e.data.count,
          hostname: hostname,
        });
      } catch (err) {
        // Extension context invalidated (reload/update) — ignore
      }
    }
  });

  // Listen for whitelist changes from the popup/background
  chrome.storage.onChanged.addListener(function (changes) {
    if (changes.whitelist) {
      const newList = changes.whitelist.newValue || [];
      const isNowWhitelisted = newList.includes(hostname);
      window.postMessage({ type: "__shutup_whitelist", whitelisted: isNowWhitelisted }, "*");

      // If just whitelisted, reload to let media play normally
      if (isNowWhitelisted) {
        location.reload();
      }
    }
  });
})();
