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

  // Same request the site sends when you press "Unfollow" on a profile.
  async function unfollow(id) {
    if (!/^\d+$/.test(String(id))) return { ok: false, message: 'bad id' };
    let res;
    let data = null;
    try {
      res = await fetch(`/api/v1/friendships/destroy/${id}/`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'X-IG-App-ID': APP_ID,
          'X-CSRFToken': cookie('csrftoken'),
          'X-Requested-With': 'XMLHttpRequest',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ user_id: String(id), container_module: 'profile' }),
      });
      data = await res.json();
    } catch {
      // network error or non-JSON (e.g. logged out)
    }
    if (res && res.ok && data && data.status === 'ok') return { ok: true };
    return {
      ok: false,
      status: res ? res.status : 0,
      blocked: !!(data && (data.feedback_required || data.spam || /feedback|block|wait/i.test(data.message || ''))),
      message: (data && (data.feedback_message || data.message)) || (res ? 'HTTP ' + res.status : 'network error'),
    };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'igft-unfollow') {
      unfollow(msg.id).then(sendResponse);
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
