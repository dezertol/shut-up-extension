/**
 * popup.js — Logic for the extension popup.
 */
(function () {
  "use strict";

  const countEl = document.getElementById("count");
  const hostnameEl = document.getElementById("hostname");
  const toggleEl = document.getElementById("whitelist-toggle");
  const statusEl = document.getElementById("status");

  let currentHostname = "";

  // Get the active tab info
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (!tabs[0]) return;
    const tab = tabs[0];
    const tabId = tab.id;

    try {
      const url = new URL(tab.url);
      currentHostname = url.hostname;
      hostnameEl.textContent = currentHostname;
    } catch (e) {
      hostnameEl.textContent = "N/A";
      return;
    }

    // Get blocked count for this tab
    chrome.runtime.sendMessage({ type: "getCountForTab", tabId: tabId }, function (resp) {
      if (resp && resp.count !== undefined) {
        countEl.textContent = String(resp.count);
      }
    });

    // Get whitelist status
    chrome.storage.sync.get({ whitelist: [] }, function (data) {
      const isWhitelisted = data.whitelist.includes(currentHostname);
      toggleEl.checked = isWhitelisted;
      updateStatus(isWhitelisted);
    });
  });

  // Toggle whitelist
  toggleEl.addEventListener("change", function () {
    if (!currentHostname) return;

    chrome.runtime.sendMessage(
      { type: "toggleWhitelist", hostname: currentHostname },
      function (resp) {
        if (resp) {
          updateStatus(resp.whitelisted);
        }
      }
    );
  });

  function updateStatus(whitelisted) {
    if (whitelisted) {
      statusEl.textContent = "Autoplay allowed on this site";
      statusEl.className = "status allowed";
    } else {
      statusEl.textContent = "Blocking autoplay";
      statusEl.className = "status blocking";
    }
  }
})();
