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

// Unfollows started from the dashboard are verified and saved by the dashboard
// itself, so the raw network request must not be taken as proof here.
const handledByDashboard = new Map(); // user id -> expiry time
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'igft-expect-unfollow') {
    handledByDashboard.set(String(msg.id), Date.now() + 2 * 60 * 1000);
    sendResponse({ ok: true });
  }
});

// Requests are followed through three events: the body (onBeforeRequest),
// the headers (onSendHeaders) and the result (onCompleted).
const WATCH_URLS = [
  'https://www.instagram.com/api/v1/*',
  'https://www.instagram.com/web/friendships/*',
  'https://www.instagram.com/graphql/*',
  'https://www.instagram.com/api/graphql*',
];
const inFlight = new Map(); // requestId -> { body, headers }

function decodeBody(rb) {
  if (!rb) return null;
  if (rb.formData) {
    const p = new URLSearchParams();
    for (const [k, vs] of Object.entries(rb.formData)) for (const v of vs) p.append(k, v);
    return p.toString();
  }
  if (rb.raw && rb.raw[0] && rb.raw[0].bytes) return new TextDecoder().decode(rb.raw[0].bytes);
  return null;
}

chrome.webRequest.onBeforeRequest.addListener(
  (d) => {
    if (d.method !== 'POST') return;
    inFlight.set(d.requestId, { body: decodeBody(d.requestBody) });
    if (inFlight.size > 300) inFlight.delete(inFlight.keys().next().value);
  },
  { urls: WATCH_URLS },
  ['requestBody']
);

chrome.webRequest.onSendHeaders.addListener(
  (d) => {
    const entry = inFlight.get(d.requestId);
    if (entry) entry.headers = d.requestHeaders || [];
  },
  { urls: WATCH_URLS },
  ['requestHeaders']
);

chrome.webRequest.onErrorOccurred.addListener((d) => inFlight.delete(d.requestId), { urls: WATCH_URLS });

chrome.webRequest.onCompleted.addListener(
  (details) => {
    const entry = inFlight.get(details.requestId);
    inFlight.delete(details.requestId);
    if (details.method !== 'POST' || details.statusCode !== 200) return;
    const hit = IGFT.parseFriendshipRequest(details.url, entry && entry.body);
    if (!hit) return;
    const until = handledByDashboard.get(hit.id);
    if (until && until > Date.now()) return; // the dashboard's own attempt
    // A real unfollow done on the site: remember exactly how it was sent, so
    // the dashboard's Unfollow button can repeat it for other accounts.
    if (hit.action === 'unfollow' && entry) {
      queue = queue.then(() => saveTemplate(details.url, entry, hit.id));
    }
    // Serialise updates so two quick clicks don't overwrite each other.
    queue = queue.then(() => applyLive(hit)).catch((e) => console.warn('IGFT live update failed', e));
  },
  { urls: WATCH_URLS }
);

async function saveTemplate(url, entry, targetId) {
  const headers = {};
  for (const h of entry.headers || []) {
    const name = h.name.toLowerCase();
    if (name.startsWith('x-') || name === 'content-type') headers[h.name] = h.value;
  }
  await chrome.storage.local.set({
    unfollowTemplate: { url, body: entry.body, headers, targetId: String(targetId), savedAt: Date.now() },
  });
}

async function applyLive({ action, id }) {
  const cookie = await chrome.cookies.get({ url: 'https://www.instagram.com', name: 'ds_user_id' });
  const myId = cookie && cookie.value;
  if (!myId) return;
  const key = 'acct_' + myId;
  const account = (await chrome.storage.local.get(key))[key];
  const updated = IGFT.applyLiveChange(account, action, id, Date.now());
  if (updated) await chrome.storage.local.set({ [key]: updated });
}
