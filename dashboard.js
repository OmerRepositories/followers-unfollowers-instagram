const $ = (s) => document.querySelector(s);
const PAGE = 300;
const STALE_MS = 6 * 60 * 1000;

const { t } = I18N;
I18N.applyToDocument(document);

const TAB_IDS = ['notBack', 'lost', 'gained', 'fans', 'mutual', 'iUnfollowed', 'whitelist', 'history'];
const errText = (code) => {
  const msg = t('err_' + code);
  return msg === 'err_' + code ? code : msg;
};

let store = {};
let accountId = null;
let tab = 'notBack';
let limit = PAGE;

// ---------- data ----------
async function load() {
  store = await chrome.storage.local.get(null);
  const ids = accountIds();
  if (!accountId || !ids.includes(accountId)) {
    accountId = ids.includes(store.lastAccount) ? store.lastAccount : ids[0] || null;
  }
  render();
}

const accountIds = () => Object.keys(store).filter((k) => k.startsWith('acct_')).map((k) => k.slice(5));
const account = () => (accountId ? store['acct_' + accountId] : null);
const whitelist = () => new Set(store['wl_' + accountId] || []);

async function setWhitelist(set) {
  await chrome.storage.local.set({ ['wl_' + accountId]: [...set] });
}

function lists() {
  const acct = account();
  if (!acct) return null;
  const a = IGFT.analyze(acct, store['wl_' + accountId]);
  const events = (type) => acct.events.filter((e) => e.type === type);
  return {
    notBack: a.notFollowingBack.map((id) => ({ id })),
    fans: a.fans.map((id) => ({ id })),
    mutual: a.mutual.map((id) => ({ id })),
    lost: events('lost'),
    gained: events('gained'),
    iUnfollowed: events('iUnfollowed'),
    whitelist: [...whitelist()].map((id) => ({ id })),
  };
}

// ---------- rendering ----------
const fmtDate = (ts) => new Date(ts).toLocaleString(I18N.locale, { dateStyle: 'short', timeStyle: 'short' });
const fmtNum = (n) => (n ?? 0).toLocaleString(I18N.locale);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function render() {
  renderHeader();
  renderProgress();
  const acct = account();
  const L = lists();
  renderStats(acct, L);
  renderTabs(L);
  renderList(acct, L);
}

function renderHeader() {
  const ids = accountIds();
  const sel = $('#accountSelect');
  sel.hidden = ids.length < 2;
  sel.innerHTML = ids.map((id) => `<option value="${id}" ${id === accountId ? 'selected' : ''}>@${esc(store['acct_' + id].username)}</option>`).join('');
  const acct = account();
  $('#accountLine').textContent = acct
    ? t('accountLine', { user: acct.username, date: fmtDate(acct.lastScan), n: acct.history.length })
    : t('noScanHeader');
}

function scanState() {
  const s = store.scanState;
  if (s && (s.status === 'running' || s.status === 'paused') && Date.now() - (s.updated || 0) > STALE_MS) {
    return { ...s, status: 'error', error: 'STALE' };
  }
  return s;
}

// A saved partial scan for the logged-in account that can be continued.
function resumableCheckpoint() {
  const ck = store.scanCheckpoint;
  if (!ck || Date.now() - ck.startedAt > 24 * 60 * 60 * 1000) return null;
  return ck;
}

function renderProgress() {
  const s = scanState();
  const isPaused = !!s && s.status === 'paused';
  const running = !!s && (s.status === 'running' || isPaused);
  const ck = resumableCheckpoint();
  const canResume = !running && !!ck;
  $('#scanBtn').disabled = running;
  $('#scanBtn').textContent = canResume
    ? t('resumeScan', { n: fmtNum(ck.followers.length + ck.following.length) })
    : t('scanNow');
  $('#restartBtn').hidden = !canResume;
  $('#pauseBtn').hidden = !running;
  $('#pauseBtn').textContent = isPaused ? t('resume') : t('pause');
  $('#pauseBtn').classList.toggle('primary', isPaused);
  $('#cancelBtn').hidden = !running;
  $('#progress').hidden = !running;
  if (running) {
    const phase = s.phase ? t('phase_' + s.phase) : '';
    let text = (isPaused ? t('pausedPrefix') : '') + phase;
    if (s.phase === 'followers' || s.phase === 'following') {
      text += `: ${fmtNum(s.done)}` + (s.total ? t('progressOf', { total: fmtNum(s.total) }) : '');
    }
    if (s.waitingUntil && s.waitingUntil > Date.now()) {
      const sec = Math.ceil((s.waitingUntil - Date.now()) / 1000);
      text += s.waitReason === 'rate'
        ? t('waitRate', { sec })
        : t('waitRetry', { sec });
      if (s.lastProblem) text += ` (${s.lastProblem})`;
    }
    $('#progressText').textContent = text + (isPaused ? t('tailPaused') : t('tailRunning'));
    const fill = $('#progressFill');
    if (s.total && (s.phase === 'followers' || s.phase === 'following')) {
      fill.classList.remove('indeterminate');
      const half = Math.min(1, s.done / s.total) * 50;
      fill.style.width = (s.phase === 'followers' ? half : 50 + half) + '%';
    } else {
      fill.classList.add('indeterminate');
      fill.style.width = '';
    }
  }

  const msg = $('#message');
  msg.hidden = true;
  if (s && s.status === 'error') {
    msg.hidden = false;
    msg.className = 'message error';
    msg.textContent = t('scanFailed', { why: errText(s.error) }) + (canResume ? t('progressSaved') : '');
  } else if (s && s.status === 'cancelled' && canResume) {
    msg.hidden = false;
    msg.className = 'message';
    msg.textContent = t('scanStopped');
  } else if (s && s.status === 'done' && s.summary && Date.now() - s.finishedAt < 10 * 60 * 1000) {
    const x = s.summary;
    msg.hidden = false;
    msg.className = 'message ok';
    msg.textContent = x.first
      ? t('firstScanDone', { followers: fmtNum(x.followers), following: fmtNum(x.following) })
      : t('scanDone', { lost: fmtNum(x.lost), gained: fmtNum(x.gained) });
  }
}

function renderStats(acct, L) {
  if (!acct) { $('#stats').innerHTML = ''; return; }
  const prev = acct.history[acct.history.length - 2];
  const delta = (cur, key) => {
    if (!prev) return '';
    const d = cur - prev[key];
    return d ? ` <span class="${d > 0 ? 'up' : 'down'}" style="font-size:13px">${d > 0 ? '+' : ''}${d}</span>` : '';
  };
  const tiles = [
    { lbl: t('stat_followers'), num: fmtNum(acct.followers.length) + delta(acct.followers.length, 'followers'), tab: 'fans' },
    { lbl: t('stat_following'), num: fmtNum(acct.following.length) + delta(acct.following.length, 'following'), tab: 'mutual' },
    { lbl: t('stat_notBack'), num: fmtNum(L.notBack.length), tab: 'notBack', cls: 'bad' },
    { lbl: t('stat_lost'), num: fmtNum(L.lost.length), tab: 'lost', cls: 'bad' },
    { lbl: t('stat_gained'), num: fmtNum(L.gained.length), tab: 'gained', cls: 'good' },
    { lbl: t('stat_mutual'), num: fmtNum(L.mutual.length), tab: 'mutual' },
  ];
  $('#stats').innerHTML = tiles.map((t) =>
    `<div class="stat" data-tab="${t.tab}"><div class="num ${t.cls || ''}">${t.num}</div><div class="lbl">${t.lbl}</div></div>`
  ).join('');
}

function renderTabs(L) {
  $('#tabs').innerHTML = TAB_IDS.map((id) => {
    const n = L && L[id] ? `<span class="count">${fmtNum(L[id].length)}</span>` : '';
    return `<button data-tab="${id}" class="${id === tab ? 'active' : ''}">${esc(t('tab_' + id))}${n}</button>`;
  }).join('');
  $('#tabHint').textContent = t('hint_' + tab);
  const learn = $('#learnStatus');
  const tpl = store.unfollowTemplate;
  learn.hidden = !account() || tab === 'history' || tab === 'fans' || tab === 'gained';
  learn.className = 'hint learn ' + (tpl ? 'ok' : 'warn');
  learn.textContent = tpl ? t('learnedYes', { date: fmtDate(tpl.savedAt) }) : t('learnedNo');
}

function filtered(acct, L) {
  const q = $('#search').value.trim().toLowerCase();
  const hideV = $('#hideVerified').checked;
  return (L[tab] || []).filter((item) => {
    const u = acct.users[item.id];
    if (!u) return false;
    if (hideV && u.v) return false;
    return !q || u.u.toLowerCase().includes(q) || u.n.toLowerCase().includes(q);
  });
}

function renderList(acct, L) {
  const list = $('#list');
  const toolbarHidden = !acct || tab === 'history';
  document.querySelector('.toolbar').style.display = toolbarHidden ? 'none' : '';
  $('#moreBtn').hidden = true;

  if (!acct) {
    list.innerHTML = `<div class="empty">${esc(t('emptyNoData'))}</div>`;
    return;
  }
  if (tab === 'history') return renderHistory(acct);

  if ((tab === 'lost' || tab === 'gained' || tab === 'iUnfollowed') && acct.history.length < 2 && !(L[tab] || []).length) {
    list.innerHTML = `<div class="empty">${esc(t('emptyNeedTwo'))}</div>`;
    return;
  }

  const items = filtered(acct, L);
  if (!items.length) {
    list.innerHTML = `<div class="empty">${esc(t('emptyList'))}</div>`;
    return;
  }
  const wl = whitelist();
  const followers = new Set(acct.followers);
  const following = new Set(acct.following);
  list.innerHTML = items.slice(0, limit).map((item) => {
    const u = acct.users[item.id];
    const initial = esc((u.u[0] || '?').toUpperCase());
    const ready = picUrls.get(item.id);
    const avatar = ready
      ? `<div class="avatar"><img src="${ready}" alt=""></div>`
      : `<div class="avatar" data-pic="${item.id}">${initial}</div>`;
    const badge = (key) => `<span class="badge">${esc(t(key))}</span>`;
    const badges = (u.v ? badge('badgeVerified') : '') + (u.p ? badge('badgePrivate') : '');
    let status = '';
    if (tab === 'lost') status = following.has(item.id) ? badge('badgeStillFollowing') : '';
    if (tab === 'lost' && followers.has(item.id)) status = badge('badgeFollowsAgain');
    const starred = wl.has(item.id);
    return `<div class="row">
      ${avatar}
      <div class="who">
        <a href="https://www.instagram.com/${encodeURIComponent(u.u)}/" target="_blank" rel="noopener">@${esc(u.u)}</a>${badges}${status}
        <div class="name">${esc(u.n)}</div>
      </div>
      ${item.t ? `<span class="when">${fmtDate(item.t)}</span>` : ''}
      ${unfollowButton(item.id, following)}
      <button data-star="${item.id}" title="${esc(starred ? t('wlRemove') : t('wlAdd'))}">${starred ? '★' : '☆'}</button>
    </div>`;
  }).join('');
  observePics(acct);
  if (items.length > limit) {
    $('#moreBtn').hidden = false;
    $('#moreBtn').textContent = t('showMoreN', { n: fmtNum(items.length - limit) });
  }
}

function unfollowButton(id, following) {
  const st = unfollowState.get(id);
  if (!following.has(id) && st !== 'working') return '';
  const label = t({ queued: 'unfollowQueued', working: 'unfollowWorking', error: 'unfollowFailed' }[st] || 'unfollow');
  const busy = st === 'queued' || st === 'working';
  return `<button class="danger" data-unfollow="${id}" ${busy ? 'disabled' : ''}>${label}</button>`;
}

function renderHistory(acct) {
  const rows = [...acct.history].reverse().map((h, i, arr) => {
    const prev = arr[i + 1];
    const d = (key) => {
      if (!prev) return '';
      const x = h[key] - prev[key];
      return x ? ` <span class="${x > 0 ? 'up' : 'down'}">(${x > 0 ? '+' : ''}${x})</span>` : '';
    };
    return `<tr><td>${fmtDate(h.t)}</td><td>${fmtNum(h.followers)}${d('followers')}</td><td>${fmtNum(h.following)}${d('following')}</td>
      <td class="${h.lost ? 'down' : ''}">${h.first ? '—' : fmtNum(h.lost)}</td><td class="${h.gained ? 'up' : ''}">${h.first ? '—' : fmtNum(h.gained)}</td></tr>`;
  }).join('');
  $('#list').innerHTML = `<table class="hist"><thead><tr>${['th_date', 'th_followers', 'th_following', 'th_lost', 'th_gained'].map((k) => `<th>${esc(t(k))}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
}

// ---------- profile pictures ----------
// Instagram's CDN won't let an extension page show its images in a plain <img>,
// so they are downloaded with fetch (allowed by host_permissions), kept in the
// Cache API by user id, and shown from a blob: URL. The cached copy outlives the
// signed CDN link, so people who unfollowed you keep their picture.
const PIC_CACHE = 'igft-pics-v1';
const PIC_CONCURRENCY = 6;
const picUrls = new Map(); // user id -> blob: URL
const picPending = new Set();
const picQueue = [];
let picActive = 0;
let picAccount = null;

const picObserver = new IntersectionObserver((entries) => {
  for (const en of entries) {
    if (!en.isIntersecting) continue;
    picObserver.unobserve(en.target);
    queuePic(en.target.dataset.pic);
  }
}, { rootMargin: '400px' });

function observePics(acct) {
  picAccount = acct;
  picObserver.disconnect();
  document.querySelectorAll('#list [data-pic]').forEach((el) => picObserver.observe(el));
}

function queuePic(id) {
  if (!id || picUrls.has(id) || picPending.has(id)) return;
  picPending.add(id);
  picQueue.push(id);
  pumpPics();
}

function pumpPics() {
  while (picActive < PIC_CONCURRENCY && picQueue.length) {
    const id = picQueue.shift();
    picActive++;
    loadPic(id)
      .then((url) => {
        if (!url) return;
        picUrls.set(id, url);
        document.querySelectorAll(`#list [data-pic="${id}"]`).forEach((el) => {
          el.removeAttribute('data-pic');
          el.innerHTML = `<img src="${url}" alt="">`;
        });
      })
      .catch(() => {})
      .finally(() => {
        picActive--;
        picPending.delete(id);
        pumpPics();
      });
  }
}

async function loadPic(id) {
  const u = picAccount && picAccount.users[id];
  const src = u && u.pic;
  const key = `https://igft.invalid/pic/${id}`;
  const cache = await caches.open(PIC_CACHE);
  const cached = await cache.match(key);
  if (cached && (!src || cached.headers.get('x-src') === src)) {
    return URL.createObjectURL(await cached.blob());
  }
  if (src) {
    try {
      const res = await fetch(src, { credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (res.ok) {
        const blob = await res.blob();
        if (blob.type.startsWith('image/')) {
          await cache.put(key, new Response(blob, { headers: { 'content-type': blob.type, 'x-src': src } }));
          return URL.createObjectURL(blob);
        }
      }
    } catch {
      // fall through to the older cached copy, if any
    }
  }
  return cached ? URL.createObjectURL(await cached.blob()) : null;
}

// ---------- scanning ----------
async function findInstagramTab() {
  const tabs = await chrome.tabs.query({ url: 'https://www.instagram.com/*' });
  if (tabs.length) return tabs[0];
  const t = await chrome.tabs.create({ url: 'https://www.instagram.com/', active: false });
  await new Promise((resolve) => {
    const onUpdated = (id, info) => {
      if (id === t.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    setTimeout(resolve, 20000);
  });
  return t;
}

// Makes sure an instagram.com tab with the scanner script exists; returns its id.
async function ensureScanner() {
  const t = await findInstagramTab();
  if (!t) throw new Error('NO_TAB');
  await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['lib/core.js', 'scanner.js'] });
  return t.id;
}

async function startScan(resume) {
  $('#scanBtn').disabled = true;
  try {
    const tabId = await ensureScanner();
    await chrome.tabs.sendMessage(tabId, { type: 'igft-scan', resume });
  } catch (e) {
    await chrome.storage.local.set({ scanState: { status: 'error', error: String(e.message || e), updated: Date.now() } });
  }
}

async function togglePause() {
  const s = store.scanState;
  const type = s && s.status === 'paused' ? 'igft-resume' : 'igft-pause';
  const tabs = await chrome.tabs.query({ url: 'https://www.instagram.com/*' });
  for (const t of tabs) chrome.tabs.sendMessage(t.id, { type }).catch(() => {});
}

async function cancelScan() {
  const tabs = await chrome.tabs.query({ url: 'https://www.instagram.com/*' });
  for (const t of tabs) chrome.tabs.sendMessage(t.id, { type: 'igft-cancel' }).catch(() => {});
  // If no scanner answered (tab closed), clear the stuck state ourselves.
  setTimeout(async () => {
    const { scanState: s } = await chrome.storage.local.get('scanState');
    if (s && (s.status === 'running' || s.status === 'paused')) await chrome.storage.local.set({ scanState: { ...s, status: 'cancelled' } });
  }, 3000);
}

// ---------- unfollow ----------
// Clicks go into a queue that sends one unfollow every few seconds, because
// unfollowing many accounts quickly gets the account action-blocked.
const unfollowState = new Map(); // id -> 'queued' | 'working' | 'error'
const unfollowQueue = [];
let unfollowBusy = false;
let lastUnfollowAt = 0;

function notice(text, kind) {
  const el = $('#notice');
  el.hidden = !text;
  el.className = 'message ' + (kind || '');
  el.textContent = text || '';
}

function requestUnfollow(id) {
  const st = unfollowState.get(id);
  if (st === 'queued' || st === 'working') return;
  unfollowState.set(id, 'queued');
  unfollowQueue.push(id);
  render();
  pumpUnfollow();
}

async function pumpUnfollow() {
  if (unfollowBusy) return;
  unfollowBusy = true;
  try {
    while (unfollowQueue.length) {
      const id = unfollowQueue.shift();
      const wait = lastUnfollowAt + 3000 + Math.random() * 3000 - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      unfollowState.set(id, 'working');
      render();
      let result;
      try {
        const tabId = await ensureScanner();
        await chrome.runtime.sendMessage({ type: 'igft-expect-unfollow', id }).catch(() => {});
        const username = account() && account().users[id] && account().users[id].u;
        result = await chrome.tabs.sendMessage(tabId, { type: 'igft-unfollow', id, username });
      } catch (e) {
        result = { ok: false, message: String(e.message || e) };
      }
      if (result && result.attempts) console.info('IGFT unfollow', id, result);
      if (result && !result.ok) console.info('IGFT recent instagram.com POST requests', (await chrome.storage.local.get('recentPosts')).recentPosts);
      lastUnfollowAt = Date.now();
      const name = '@' + ((account() && account().users[id] && account().users[id].u) || id);
      if (result && result.ok) {
        unfollowState.delete(id);
        const key = 'acct_' + accountId;
        const acct = (await chrome.storage.local.get(key))[key];
        const updated = IGFT.applyLiveChange(acct, 'unfollow', id, Date.now());
        if (updated) await chrome.storage.local.set({ [key]: updated });
        notice(t(result.verified === false ? 'unfollowDoneUnverified' : 'unfollowDone', { name }) +
          (unfollowQueue.length ? t('unfollowQueueLeft', { n: unfollowQueue.length }) : ''), 'ok');
      } else {
        unfollowState.set(id, 'error');
        const why = result && result.message ? errText(result.message) : t('err_unknown');
        if (result && (result.blocked || result.status === 429)) {
          // Stop everything: continuing would make the block longer.
          for (const q of unfollowQueue.splice(0)) unfollowState.delete(q);
          notice(t('unfollowBlocked', { why }), 'error');
        } else {
          notice(t('unfollowError', { name, why }), 'error');
        }
      }
      render();
    }
  } finally {
    unfollowBusy = false;
  }
}

// ---------- export ----------
function exportCsv() {
  const acct = account();
  if (!acct) return;
  const items = filtered(acct, lists());
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['username', 'full_name', 'profile_url', 'verified', 'private', 'date'].join(',')];
  for (const item of items) {
    const u = acct.users[item.id];
    lines.push([u.u, u.n, `https://www.instagram.com/${u.u}/`, u.v, u.p, item.t ? new Date(item.t).toISOString() : ''].map(cell).join(','));
  }
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `instagram-${acct.username}-${tab}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- events ----------
function selectTab(id) {
  tab = id;
  limit = PAGE;
  render();
}

$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (b) selectTab(b.dataset.tab);
});
$('#stats').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (b) selectTab(b.dataset.tab);
});
$('#list').addEventListener('click', async (e) => {
  const un = e.target.closest('[data-unfollow]');
  if (un) return requestUnfollow(un.dataset.unfollow);
  const b = e.target.closest('[data-star]');
  if (!b) return;
  const wl = whitelist();
  const id = b.dataset.star;
  wl.has(id) ? wl.delete(id) : wl.add(id);
  await setWhitelist(wl);
});
$('#search').addEventListener('input', () => { limit = PAGE; render(); });
$('#hideVerified').addEventListener('change', () => { limit = PAGE; render(); });
$('#moreBtn').addEventListener('click', () => { limit += PAGE; render(); });
$('#exportBtn').addEventListener('click', exportCsv);
$('#scanBtn').addEventListener('click', () => startScan(!!resumableCheckpoint()));
$('#restartBtn').addEventListener('click', () => startScan(false));
$('#pauseBtn').addEventListener('click', togglePause);
$('#cancelBtn').addEventListener('click', cancelScan);
$('#accountSelect').addEventListener('change', (e) => { accountId = e.target.value; render(); });
$('#clearBtn').addEventListener('click', async () => {
  if (!confirm(t('clearConfirm'))) return;
  await chrome.storage.local.clear();
  await caches.delete(PIC_CACHE);
  picUrls.clear();
  accountId = null;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  // Only the progress changed: avoid re-rendering the whole list.
  // The request log changes all the time and isn't shown; ignore it.
  if (Object.keys(changes).every((k) => k === 'recentPosts')) return;
  if (Object.keys(changes).every((k) => k === 'scanState' || k === 'scanCheckpoint')) {
    for (const k of Object.keys(changes)) store[k] = changes[k].newValue;
    renderProgress();
    const st = store.scanState && store.scanState.status;
    if (changes.scanState && st !== 'running' && st !== 'paused') load();
    return;
  }
  load();
});
// Keep the "retrying in N seconds" countdown ticking.
setInterval(() => {
  const s = store.scanState;
  if (s && s.status === 'running' && s.waitingUntil) renderProgress();
}, 1000);

load();
