// Injected into an instagram.com tab. Uses the logged-in session to page through
// the followers / following lists, then saves the result to chrome.storage.
(() => {
  // After the extension is reloaded, an old copy may still be marked as loaded
  // but can no longer talk to the extension, so it does not count.
  if (globalThis.__igftScannerAlive && globalThis.__igftScannerAlive()) return;
  globalThis.__igftScannerAlive = () => {
    try { return !!chrome.runtime.id; } catch { return false; }
  };

  const APP_ID = '936619743392459'; // Instagram web app id, required by the API
  const PAGE_SIZE = 50;

  let running = false;
  let cancelled = false;
  let state = {};

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const jitter = (min, max) => min + Math.random() * (max - min);
  const cookie = (name) => {
    const m = document.cookie.match('(?:^|; )' + name + '=([^;]*)');
    return m ? decodeURIComponent(m[1]) : '';
  };

  async function setState(patch) {
    state = { ...state, ...patch, updated: Date.now() };
    await chrome.storage.local.set({ scanState: state });
  }

  async function waitWithCountdown(ms, reason) {
    const until = Date.now() + ms;
    await setState({ waitingUntil: until, waitReason: reason });
    while (Date.now() < until) {
      if (cancelled) throw new Error('CANCELLED');
      await sleep(1000);
    }
    await setState({ waitingUntil: null, waitReason: null });
  }

  // retries: how many attempts before giving up. Optional lookups use 1 so a
  // blocked endpoint never stalls the scan.
  async function api(path, retries = 6) {
    for (let attempt = 1; ; attempt++) {
      if (cancelled) throw new Error('CANCELLED');
      let res = null;
      let data = null;
      try {
        res = await fetch(path, {
          credentials: 'include',
          headers: {
            'X-IG-App-ID': APP_ID,
            'X-Requested-With': 'XMLHttpRequest',
            'X-CSRFToken': cookie('csrftoken'),
          },
        });
        if (res.status === 401 || res.status === 403) throw new Error('AUTH');
        if (res.ok) {
          try {
            data = await res.json();
          } catch {
            throw new Error('AUTH'); // got an HTML login page instead of JSON
          }
          if (data && data.status !== 'fail') return data;
        }
      } catch (e) {
        if (e.message === 'AUTH' || e.message === 'CANCELLED') throw e;
      }
      if (data && data.require_login) throw new Error('AUTH');
      const detail = 'HTTP ' + (res ? res.status : 'network') + (data && data.message ? ' — ' + data.message : '');
      if (attempt >= retries) throw new Error(detail);
      const rateLimited = (res && res.status === 429) || (data && /wait|few minutes/i.test(data.message || ''));
      await setState({ lastProblem: detail });
      await waitWithCountdown(rateLimited ? 60000 * attempt : 5000 * attempt, rateLimited ? 'rate' : 'retry');
    }
  }

  // ---------- pause / resume ----------
  // Pausing keeps everything in memory. Progress is also saved to storage
  // (scanCheckpoint), so after "Stop", a closed tab or an error the next scan
  // continues where it left off instead of starting over.
  let paused = false;
  const CHECKPOINT_KEY = 'scanCheckpoint';
  const CHECKPOINT_MAX_AGE = 24 * 60 * 60 * 1000;
  let checkpoint = null;
  let pagesSinceSave = 0;

  const keepFields = (u) => ({
    pk: u.pk ?? u.pk_id ?? u.id,
    username: u.username,
    full_name: u.full_name,
    profile_pic_url: u.profile_pic_url,
    is_verified: u.is_verified,
    is_private: u.is_private,
  });

  async function saveCheckpoint() {
    pagesSinceSave = 0;
    if (checkpoint) await chrome.storage.local.set({ [CHECKPOINT_KEY]: { ...checkpoint, savedAt: Date.now() } });
  }

  async function checkPause() {
    if (!paused) return;
    await saveCheckpoint();
    await setState({ status: 'paused' });
    let beat = Date.now();
    while (paused) {
      if (cancelled) throw new Error('CANCELLED');
      await sleep(500);
      // Heartbeat so the dashboard knows the tab is still alive.
      if (Date.now() - beat > 60000) { beat = Date.now(); await setState({}); }
    }
    await setState({ status: 'running' });
  }

  async function fetchList(userId, kind) {
    const out = checkpoint[kind];
    let maxId = checkpoint.phase === kind ? checkpoint.maxId : null;
    await setState({ phase: kind, done: out.length, total: checkpoint.totals[kind] || null });
    do {
      await checkPause();
      let url = `/api/v1/friendships/${userId}/${kind}/?count=${PAGE_SIZE}`;
      if (kind === 'followers') url += '&search_surface=follow_list_page';
      if (maxId) url += '&max_id=' + encodeURIComponent(maxId);
      const data = await api(url);
      out.push(...(data.users || []).map(keepFields));
      maxId = data.next_max_id || null;
      checkpoint.phase = kind;
      checkpoint.maxId = maxId;
      if (++pagesSinceSave >= 5) await saveCheckpoint();
      await setState({ done: out.length });
      if (maxId) await sleep(jitter(900, 2200));
      // Longer pause every ~1000 accounts to stay under Instagram's limits.
      if (maxId && out.length % 1000 < PAGE_SIZE) await sleep(jitter(8000, 15000));
    } while (maxId);
    return out;
  }

  async function run(resume) {
    running = true;
    cancelled = false;
    paused = false;
    state = {};
    checkpoint = null;
    try {
      await setState({ status: 'running', phase: 'init', error: null, startedAt: Date.now(), resumed: false });
      const myId = cookie('ds_user_id');
      if (!myId) throw new Error('NOT_LOGGED_IN');

      const saved = (await chrome.storage.local.get(CHECKPOINT_KEY))[CHECKPOINT_KEY];
      if (resume && saved && saved.accountId === myId && Date.now() - saved.startedAt < CHECKPOINT_MAX_AGE) {
        checkpoint = saved;
        await setState({ resumed: true });
      } else {
        await chrome.storage.local.remove(CHECKPOINT_KEY);
      }

      if (!checkpoint) {
        // Username and totals are only for display and the progress bar, so each
        // lookup is tried once and the scan goes on without them if they fail.
        const optional = async (path) => {
          try {
            return await api(path, 1);
          } catch (e) {
            if (e.message === 'CANCELLED') throw e;
            return null;
          }
        };
        const form = await optional('/api/v1/accounts/edit/web_form_data/');
        let username = (form && form.form_data && form.form_data.username) || '';
        if (!username) {
          const prevKey = 'acct_' + myId;
          const prev = (await chrome.storage.local.get(prevKey))[prevKey];
          username = (prev && prev.username) || '';
        }
        const totals = {};
        if (username) {
          const prof = await optional(`/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`);
          const u = prof && prof.data && prof.data.user;
          if (u) {
            totals.followers = u.edge_followed_by && u.edge_followed_by.count;
            totals.following = u.edge_follow && u.edge_follow.count;
          }
        }
        checkpoint = {
          accountId: myId, username, totals, startedAt: Date.now(),
          phase: 'followers', maxId: null, followers: [], following: [],
        };
        await saveCheckpoint();
      }
      const username = checkpoint.username;
      await setState({ accountId: myId, username });

      if (checkpoint.phase === 'followers') {
        await fetchList(myId, 'followers');
        checkpoint.phase = 'following';
        checkpoint.maxId = null;
        await saveCheckpoint();
        await sleep(jitter(2000, 4000));
      }
      await fetchList(myId, 'following');

      const key = 'acct_' + myId;
      const prev = (await chrome.storage.local.get(key))[key] || null;
      const snapshot = IGFT.buildSnapshot(checkpoint.followers, checkpoint.following);
      const { account, newEvents } = IGFT.applyScan(prev, snapshot, Date.now());
      account.id = myId;
      account.username = username || (prev && prev.username) || myId;
      await chrome.storage.local.set({ [key]: account, lastAccount: myId });
      await chrome.storage.local.remove(CHECKPOINT_KEY);
      checkpoint = null;

      await setState({
        status: 'done',
        phase: null,
        finishedAt: Date.now(),
        summary: {
          followers: account.followers.length,
          following: account.following.length,
          lost: newEvents.filter((e) => e.type === 'lost').length,
          gained: newEvents.filter((e) => e.type === 'gained').length,
          first: !prev,
        },
      });
    } catch (e) {
      try { await saveCheckpoint(); } catch { /* extension reloaded */ }
      await setState({
        status: e.message === 'CANCELLED' ? 'cancelled' : 'error',
        error: e.message,
        waitingUntil: null,
      });
    } finally {
      running = false;
      paused = false;
    }
  }

  // ---------- unfollow ----------
  // Guessed endpoints have proven unreliable: Instagram can answer 200 and
  // still not unfollow. So:
  //  1. If you have unfollowed someone by hand on instagram.com, background.js
  //     recorded that exact request (URL, headers, body) as a template, and it
  //     is replayed first with the new user id.
  //  2. Otherwise / then, the known endpoints are tried.
  //  3. After every attempt, your "following" list is searched for the account
  //     (the same request the scan uses) to confirm it is really gone.
  const UNFOLLOW_ENDPOINTS = [
    (id) => `/api/v1/friendships/destroy/${id}/`,
    (id) => `/api/v1/web/friendships/${id}/unfollow/`,
    (id) => `/web/friendships/${id}/unfollow/`,
  ];

  const wwwClaim = () => {
    try { return sessionStorage.getItem('www-claim-v2') || '0'; } catch { return '0'; }
  };

  const postHeaders = () => ({
    'X-IG-App-ID': APP_ID,
    'X-CSRFToken': cookie('csrftoken'),
    'X-IG-WWW-Claim': wwwClaim(),
    'X-Requested-With': 'XMLHttpRequest',
    'X-ASBD-ID': '129477',
    'Content-Type': 'application/x-www-form-urlencoded',
  });

  async function getJson(url) {
    const res = await fetch(url, {
      credentials: 'include',
      cache: 'no-store',
      headers: { 'X-IG-App-ID': APP_ID, 'X-IG-WWW-Claim': wwwClaim(), 'X-Requested-With': 'XMLHttpRequest' },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  // true = still following, false = not following, null = couldn't tell.
  async function stillFollowing(id, username) {
    const myId = cookie('ds_user_id');
    if (username && myId) {
      try {
        const q = username.toLowerCase();
        const d = await getJson(`/api/v1/friendships/${myId}/following/?count=50&query=${encodeURIComponent(username)}`);
        const users = d.users || [];
        if (users.some((u) => String(u.pk ?? u.pk_id ?? u.id) === String(id))) return true;
        // Only trust "not found" if the search was really applied to the list.
        const searched = users.every((u) => (u.username || '').toLowerCase().includes(q) || (u.full_name || '').toLowerCase().includes(q));
        if (searched) return false;
      } catch {
        // fall back to the profile lookup
      }
    }
    if (!username) return null;
    try {
      const u = (await getJson(`/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`)).data.user;
      if (typeof u.followed_by_viewer !== 'boolean') return null;
      return u.followed_by_viewer || !!u.requested_by_viewer;
    } catch {
      return null;
    }
  }

  function requestFromTemplate(tpl, id) {
    const swap = (str) => str.split(tpl.targetId).join(String(id));
    const headers = {};
    for (const [k, v] of Object.entries(tpl.headers || {})) {
      const lk = k.toLowerCase();
      if (lk === 'x-csrftoken' || lk === 'x-ig-www-claim') continue; // use fresh values
      headers[k] = v;
    }
    headers['X-CSRFToken'] = cookie('csrftoken');
    headers['X-IG-WWW-Claim'] = wwwClaim();
    return {
      label: 'learned:' + tpl.url.replace(/^https:\/\/www\.instagram\.com/, '').replace(tpl.targetId, '{id}'),
      url: swap(tpl.url),
      init: { method: 'POST', credentials: 'include', headers, body: tpl.body != null ? swap(tpl.body) : undefined },
    };
  }

  function requestFromEndpoint(endpoint, id) {
    return {
      label: endpoint('{id}'),
      url: endpoint(id),
      init: {
        method: 'POST',
        credentials: 'include',
        headers: postHeaders(),
        body: new URLSearchParams({ user_id: String(id), container_module: 'profile', nav_chain: '' }),
      },
    };
  }

  async function unfollow(id, username) {
    if (!/^\d+$/.test(String(id))) return { ok: false, message: 'bad id' };
    const attempts = [];

    // Maybe it already happened (e.g. an earlier attempt worked late).
    const before = await stillFollowing(id, username);
    attempts.push('pre-check following=' + before);
    if (before === false) return { ok: true, verified: true, attempts };

    const { unfollowTemplate: tpl } = await chrome.storage.local.get('unfollowTemplate');
    const requests = [];
    if (tpl && tpl.targetId && tpl.url) requests.push(requestFromTemplate(tpl, id));
    for (const ep of UNFOLLOW_ENDPOINTS) requests.push(requestFromEndpoint(ep, id));

    let unverified = false;
    for (const r of requests) {
      let res = null;
      let data = null;
      let text = '';
      try {
        res = await fetch(r.url, r.init);
        text = await res.text();
        try { data = JSON.parse(text); } catch { /* not JSON */ }
      } catch {
        // network error
      }
      const status = res ? res.status : 0;
      const msg = (data && (data.feedback_message || data.message)) || '';
      const snippet = data ? JSON.stringify(data).slice(0, 160) : text.slice(0, 80);
      attempts.push(`${r.label} → ${status} ${snippet}`);

      if (status === 429 || (data && (data.feedback_required || data.spam))) {
        return { ok: false, blocked: true, status, message: msg || 'HTTP ' + status, attempts };
      }
      if (res && res.ok) {
        await sleep(1500);
        const following = await stillFollowing(id, username);
        attempts.push('  check following=' + following);
        if (following === false) return { ok: true, verified: true, via: r.label, attempts };
        if (following === null) unverified = true;
      }
      await sleep(jitter(700, 1500));
    }
    if (unverified) {
      await sleep(2000);
      const following = await stillFollowing(id, username);
      attempts.push('final check following=' + following);
      if (following === false) return { ok: true, verified: true, attempts };
      if (following === null) return { ok: true, verified: false, attempts };
    }
    return { ok: false, message: tpl ? 'NOT_APPLIED_LEARNED' : 'NEED_TEMPLATE', attempts };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'igft-unfollow') {
      unfollow(msg.id, msg.username).then(sendResponse);
      return true; // async response
    }
    if (msg && msg.type === 'igft-pause') {
      if (running) paused = true;
      sendResponse({ ok: running });
    } else if (msg && msg.type === 'igft-resume') {
      paused = false;
      sendResponse({ ok: running });
    } else if (msg && msg.type === 'igft-scan') {
      if (!running) run(!!msg.resume);
      sendResponse({ started: true, alreadyRunning: running });
    } else if (msg && msg.type === 'igft-cancel') {
      cancelled = true;
      sendResponse({ ok: true });
    } else if (msg && msg.type === 'igft-ping') {
      sendResponse({ running });
    }
  });
})();
