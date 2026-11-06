// Pure logic shared by the scanner (content script), the dashboard and the tests.
(function (root) {
  const MAX_EVENTS = 5000;
  const MAX_HISTORY = 300;

  function slimUser(u) {
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

  // Applies one live action to an account record. Returns the updated record,
  // or null if nothing changed (e.g. already applied, or unknown user).
  function applyLiveChange(account, action, id, now) {
    if (!account) return null;
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
      const u = account.users && account.users[id];
      // Unknown users have no name/picture to show yet, and a follow on a
      // private account is only a request; both are picked up by the next scan.
      if (following.includes(id) || !u || u.p) return null;
      return { ...account, following: [id, ...following], events: event('iFollowed') };
    }
    return null;
  }

  const api = { slimUser, buildSnapshot, applyScan, analyze, parseFriendshipUrl, applyLiveChange };
  root.IGFT = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
