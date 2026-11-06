importScripts('lib/core.js');

// Clicking the toolbar icon opens (or focuses) the dashboard tab.
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('dashboard.html');
  const [existing] = await chrome.tabs.query({ url });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
});

// When you follow / unfollow / remove a follower on instagram.com, update the
// stored lists immediately. Only requests Instagram answered with 200 count.
// Actions taken in the mobile app are not visible here; the next scan catches them.
let queue = Promise.resolve();

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.method !== 'POST' || details.statusCode !== 200) return;
    const hit = IGFT.parseFriendshipUrl(details.url);
    if (!hit) return;
    // Serialise updates so two quick clicks don't overwrite each other.
    queue = queue.then(() => applyLive(hit)).catch((e) => console.warn('IGFT live update failed', e));
  },
  { urls: ['https://www.instagram.com/api/v1/*', 'https://www.instagram.com/web/friendships/*'] }
);

async function applyLive({ action, id }) {
  const cookie = await chrome.cookies.get({ url: 'https://www.instagram.com', name: 'ds_user_id' });
  const myId = cookie && cookie.value;
  if (!myId) return;
  const key = 'acct_' + myId;
  const account = (await chrome.storage.local.get(key))[key];
  const updated = IGFT.applyLiveChange(account, action, id, Date.now());
  if (updated) await chrome.storage.local.set({ [key]: updated });
}
