// Pure logic shared by the scanner (content script), the dashboard and the tests.
(function (root) {
  const MAX_EVENTS = 5000;
  const MAX_HISTORY = 300;

  function slimUser(u) {
    // Already slim (e.g. read back from a scan checkpoint).
    if (u && typeof u.u === 'string' && u.id != null) {
      return { id: String(u.id), u: u.u, n: u.n || '', pic: u.pic || '', v: !!u.v, p: !!u.p };
    }
    return {
      id: String(u.pk ?? u.pk_id ?? u.id),
      u: u.username || '',
      n: u.full_name || '',
      pic: u.profile_pic_url || '',
      v: !!u.is_verified,
      p: !!u.is_private,
    };
  }

  // Turns raw API user lists into { users, followers: [id], following: [id] }.
  function buildSnapshot(followersRaw, followingRaw) {
    const users = {};
    const collect = (list) => {
      const ids = [];
      const seen = new Set();
      for (const raw of list) {
        const u = slimUser(raw);
        if (!u.id || u.id === 'undefined' || seen.has(u.id)) continue;
        seen.add(u.id);
        users[u.id] = u;
        ids.push(u.id);
      }
      return ids;
    };
    return { users, followers: collect(followersRaw), following: collect(followingRaw) };
  }

  // Merges a new scan into the stored account record and records what changed.
  // Event types: lost (stopped following me), gained (started following me),
  // iUnfollowed (I stopped following them), iFollowed (I started following them).
  function applyScan(prev, scan, now) {
    const events = [];
    if (prev && Array.isArray(prev.followers)) {
      const diff = (before, after, goneType, newType) => {
        const b = new Set(before);
        const a = new Set(after);
        for (const id of b) if (!a.has(id)) events.push({ t: now, type: goneType, id });
        for (const id of a) if (!b.has(id)) events.push({ t: now, type: newType, id });
      };
      diff(prev.followers, scan.followers, 'lost', 'gained');
      diff(prev.following || [], scan.following, 'iUnfollowed', 'iFollowed');
    }

    const allEvents = [...events, ...((prev && prev.events) || [])].slice(0, MAX_EVENTS);

    // Keep profile info for current lists and for anyone referenced by an event,
    // so an unfollower still shows a name and picture.
    const keep = new Set([...scan.followers, ...scan.following, ...allEvents.map((e) => e.id)]);
    const users = {};
    const oldUsers = (prev && prev.users) || {};
    for (const id of keep) {
      const u = scan.users[id] || oldUsers[id];
      if (u) users[id] = u;
    }

    const count = (type) => events.filter((e) => e.type === type).length;
    const history = [
      ...((prev && prev.history) || []),
      {
        t: now,
        followers: scan.followers.length,
        following: scan.following.length,
        lost: count('lost'),
        gained: count('gained'),
        first: !prev,
      },
    ].slice(-MAX_HISTORY);

    return {
      account: {
        ...(prev || {}),
        followers: scan.followers,
        following: scan.following,
        users,
        events: allEvents,
        history,
        lastScan: now,
        firstScan: (prev && prev.firstScan) || now,
      },
      newEvents: events,
    };
  }

  function analyze(account, whitelist) {
    const wl = new Set(whitelist || []);
    const followers = account.followers || [];
    const following = account.following || [];
    const F = new Set(followers);
    const G = new Set(following);
    return {
      notFollowingBack: following.filter((id) => !F.has(id) && !wl.has(id)),
      fans: followers.filter((id) => !G.has(id)),
      mutual: followers.filter((id) => G.has(id)),
    };
  }

  // Recognises the follow/unfollow requests instagram.com sends, so the stored
  // lists can be updated right away instead of waiting for the next scan.
  const LIVE_PATTERNS = [
    [/\/friendships\/destroy\/(\d+)/, 'unfollow'],
    [/\/web\/friendships\/(\d+)\/unfollow/, 'unfollow'],
    [/\/friendships\/remove_follower\/(\d+)/, 'removeFollower'],
    [/\/web\/friendships\/(\d+)\/remove_follower/, 'removeFollower'],
    [/\/friendships\/create\/(\d+)/, 'follow'],
    [/\/web\/friendships\/(\d+)\/follow/, 'follow'],
  ];

  function parseFriendshipUrl(url) {
    for (const [re, action] of LIVE_PATTERNS) {
      const m = re.exec(url);
      if (m) return { action, id: m[1] };
    }
    return null;
  }

  // Like parseFriendshipUrl, but also understands the GraphQL form, where the
  // action is named in fb_api_req_friendly_name and the target id sits in the
  // "variables" JSON. body is the url-encoded request body (or null).
  function parseFriendshipRequest(url, body) {
    const hit = parseFriendshipUrl(url);
    if (hit) return hit;
    if (!/\/graphql/.test(url) || !body) return null;
    let params;
    try {
      params = new URLSearchParams(body);
    } catch {
      return null;
    }
    const name = params.get('fb_api_req_friendly_name') || '';
    let action = null;
    if (/remove.?follower/i.test(name)) action = 'removeFollower';
    else if (/unfollow/i.test(name)) action = 'unfollow';
    else if (/follow/i.test(name) && /mutation/i.test(name)) action = 'follow';
    if (!action) return null;
    let vars = {};
    try {
      vars = JSON.parse(params.get('variables') || '{}');
    } catch {
      return null;
    }
    const id = findUserId(vars);
    return id ? { action, id } : null;
  }

  // Finds the numeric id under a key such as target_user_id / user_id / target_id.
  function findUserId(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 4) return null;
    for (const [k, v] of Object.entries(obj)) {
      if (/user_?id|target_?id|^id$/i.test(k) && /^\d{3,}$/.test(String(v))) return String(v);
    }
    for (const v of Object.values(obj)) {
      const found = findUserId(v, depth + 1);
      if (found) return found;
    }
    return null;
  }

  // Applies one live action to an account record. Returns the updated record,
  // or null if nothing changed (e.g. already applied, or unknown user).
  // users: the profile map (stored separately from the account); only needed
  // for 'follow'.
  function applyLiveChange(account, action, id, now, users) {
    if (!account) return null;
    users = users || account.users;
    const following = account.following || [];
    const followers = account.followers || [];
    const event = (type) => [{ t: now, type, id, live: true }, ...(account.events || [])].slice(0, MAX_EVENTS);

    if (action === 'unfollow') {
      if (!following.includes(id)) return null;
      return { ...account, following: following.filter((x) => x !== id), events: event('iUnfollowed') };
    }
    if (action === 'removeFollower') {
      if (!followers.includes(id)) return null;
      return { ...account, followers: followers.filter((x) => x !== id), events: event('iRemoved') };
    }
    if (action === 'follow') {
      const u = users && users[id];
      // Unknown users have no name/picture to show yet, and a follow on a
      // private account is only a request; both are picked up by the next scan.
      if (following.includes(id) || !u || u.p) return null;
      return { ...account, following: [id, ...following], events: event('iFollowed') };
    }
    return null;
  }

  // ---------- storage layout ----------
  // acct_<id>  : lists of ids, events, history (small; rewritten on every live change)
  // users_<id> : { id: profile } (large; written only by a scan)
  // Older versions kept the profiles inside acct_<id>.users.
  function splitAccount(account) {
    const { users, ...meta } = account;
    return { meta, users: users || {} };
  }

  // Returns the storage writes that move old-format accounts to the split
  // layout (empty object if nothing to do).
  function migrateAccounts(items) {
    const set = {};
    for (const [k, v] of Object.entries(items || {})) {
      if (!k.startsWith('acct_') || !v || !v.users) continue;
      const { meta, users } = splitAccount(v);
      set[k] = meta;
      set['users_' + k.slice(5)] = { ...users, ...(items['users_' + k.slice(5)] || {}) };
    }
    return set;
  }

  // A scan in progress is saved as a small "scanCheckpoint" record plus one
  // storage key per batch of new users, so each save writes only what is new
  // instead of the whole list collected so far.
  const KINDS = ['followers', 'following'];
  const chunkKey = (kind, i) => `ckp_${kind}_${i}`;

  function checkpointKeys(meta) {
    const keys = [];
    if (!meta || !meta.chunks) return keys;
    for (const kind of KINDS) for (let i = 0; i < (meta.chunks[kind] || 0); i++) keys.push(chunkKey(kind, i));
    return keys;
  }

  // Number of users collected so far (for the "resume" button).
  function checkpointCount(meta) {
    if (!meta) return 0;
    if (meta.counts) return (meta.counts.followers || 0) + (meta.counts.following || 0);
    return ((meta.followers || []).length) + ((meta.following || []).length);
  }

  // Rebuilds { meta, collected } from the checkpoint record and its chunk
  // items. Returns null if a chunk is missing or the counts don't add up.
  function assembleCheckpoint(meta, items) {
    if (!meta) return null;
    if (Array.isArray(meta.followers)) {
      // Format of versions <= 1.0.9: everything inside the record.
      const { followers, following, ...rest } = meta;
      return {
        meta: { ...rest, counts: { followers: 0, following: 0 }, chunks: { followers: 0, following: 0 } },
        collected: { followers: followers.map(slimUser), following: (following || []).map(slimUser) },
      };
    }
    if (!meta.counts || !meta.chunks) return null;
    const collected = {};
    for (const kind of KINDS) {
      const list = [];
      for (let i = 0; i < (meta.chunks[kind] || 0); i++) {
        const chunk = items && items[chunkKey(kind, i)];
        if (!Array.isArray(chunk)) return null;
        list.push(...chunk);
      }
      if (list.length !== (meta.counts[kind] || 0)) return null;
      collected[kind] = list;
    }
    return { meta, collected };
  }

  const api = {
    slimUser, buildSnapshot, applyScan, analyze, parseFriendshipUrl, parseFriendshipRequest, applyLiveChange,
    splitAccount, migrateAccounts, chunkKey, checkpointKeys, checkpointCount, assembleCheckpoint,
  };
  root.IGFT = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
