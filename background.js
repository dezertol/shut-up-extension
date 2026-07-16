/**
 * background.js — Service worker for badge count and whitelist management.
 */

// Track blocked counts per tab
const tabCounts = {};

// Update badge for a tab
function updateBadge(tabId, count) {
  const text = count > 0 ? String(count) : "";
  chrome.action.setBadgeText({ text: text, tabId: tabId });
  chrome.action.setBadgeBackgroundColor({ color: "#e53935", tabId: tabId });
}

// Listen for blocked messages from content scripts
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message.type === "blocked" && sender.tab) {
    const tabId = sender.tab.id;
    tabCounts[tabId] = message.count;
    updateBadge(tabId, message.count);
    sendResponse({ ok: true });
  }

  if (message.type === "getCount" && sender.tab) {
    sendResponse({ count: tabCounts[sender.tab.id] || 0 });
  }

  if (message.type === "getCountForTab") {
    sendResponse({ count: tabCounts[message.tabId] || 0 });
  }

  if (message.type === "getWhitelist") {
    chrome.storage.sync.get({ whitelist: [] }, function (data) {
      sendResponse({ whitelist: data.whitelist });
    });
    return true; // async response
  }

  if (message.type === "toggleWhitelist") {
    chrome.storage.sync.get({ whitelist: [] }, function (data) {
      const whitelist = data.whitelist;
      const hostname = message.hostname;
      const index = whitelist.indexOf(hostname);
      if (index > -1) {
        whitelist.splice(index, 1);
      } else {
        whitelist.push(hostname);
      }
      chrome.storage.sync.set({ whitelist: whitelist }, function () {
        sendResponse({ whitelist: whitelist, whitelisted: index === -1 });
      });
    });
    return true; // async response
  }
});

// Clean up when tabs close
chrome.tabs.onRemoved.addListener(function (tabId) {
  delete tabCounts[tabId];
});

// Reset count on navigation
chrome.tabs.onUpdated.addListener(function (tabId, changeInfo) {
  if (changeInfo.status === "loading") {
    tabCounts[tabId] = 0;
    updateBadge(tabId, 0);
  }
});
