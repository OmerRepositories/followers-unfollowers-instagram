const test = require('node:test');
const assert = require('node:assert');
const { buildSnapshot, applyScan, analyze } = require('../lib/core.js');

const u = (pk, username) => ({ pk, username, full_name: username.toUpperCase(), profile_pic_url: 'x', is_verified: false, is_private: false });

test('buildSnapshot dedupes and slims users', () => {
  const s = buildSnapshot([u(1, 'a'), u(1, 'a'), u(2, 'b')], [u(2, 'b'), u(3, 'c')]);
  assert.deepStrictEqual(s.followers, ['1', '2']);
  assert.deepStrictEqual(s.following, ['2', '3']);
  assert.strictEqual(s.users['3'].u, 'c');
  assert.strictEqual(s.users['1'].n, 'A');
});

test('first scan creates no events', () => {
  const { account, newEvents } = applyScan(null, buildSnapshot([u(1, 'a')], [u(2, 'b')]), 100);
  assert.strictEqual(newEvents.length, 0);
  assert.strictEqual(account.history.length, 1);
  assert.strictEqual(account.history[0].first, true);
  assert.strictEqual(account.firstScan, 100);
});

test('second scan detects lost/gained followers and following changes', () => {
  const first = applyScan(null, buildSnapshot([u(1, 'a'), u(2, 'b')], [u(1, 'a'), u(5, 'e')]), 100).account;
  const { account, newEvents } = applyScan(first, buildSnapshot([u(2, 'b'), u(3, 'c')], [u(1, 'a'), u(6, 'f')]), 200);
  const by = (type) => newEvents.filter((e) => e.type === type).map((e) => e.id);
  assert.deepStrictEqual(by('lost'), ['1']);
  assert.deepStrictEqual(by('gained'), ['3']);
  assert.deepStrictEqual(by('iUnfollowed'), ['5']);
  assert.deepStrictEqual(by('iFollowed'), ['6']);
  // Unfollower's / unfollowed profile is kept for display.
  assert.strictEqual(account.users['5'].u, 'e');
  assert.strictEqual(account.history[1].lost, 1);
  assert.strictEqual(account.firstScan, 100);
});

test('events accumulate newest first and stale users are pruned', () => {
  let acct = applyScan(null, buildSnapshot([u(1, 'a'), u(2, 'b')], [u(9, 'z')]), 1).account;
  acct = applyScan(acct, buildSnapshot([u(2, 'b')], []), 2).account;
  acct = applyScan(acct, buildSnapshot([], []), 3).account;
  assert.deepStrictEqual(acct.events.filter((e) => e.type === 'lost').map((e) => e.id), ['2', '1']);
  assert.ok(acct.users['1'] && acct.users['2'] && acct.users['9']);
  // A user with no list membership and no events is dropped.
  const extra = applyScan(acct, { users: { 77: { id: '77', u: 'x' } }, followers: [], following: [] }, 4).account;
  assert.strictEqual(extra.users['77'], undefined);
});

test('analyze splits lists and respects whitelist', () => {
  const acct = { followers: ['1', '2', '3'], following: ['2', '3', '4', '5'] };
  const a = analyze(acct, ['5']);
  assert.deepStrictEqual(a.notFollowingBack, ['4']);
  assert.deepStrictEqual(a.fans, ['1']);
  assert.deepStrictEqual(a.mutual, ['2', '3']);
});

const { parseFriendshipUrl, applyLiveChange } = require('../lib/core.js');

test('parseFriendshipUrl recognises follow/unfollow/remove requests only', () => {
  const p = (path) => parseFriendshipUrl('https://www.instagram.com' + path);
  assert.deepStrictEqual(p('/api/v1/friendships/destroy/123/'), { action: 'unfollow', id: '123' });
  assert.deepStrictEqual(p('/web/friendships/123/unfollow/'), { action: 'unfollow', id: '123' });
  assert.deepStrictEqual(p('/api/v1/friendships/create/45/'), { action: 'follow', id: '45' });
  assert.deepStrictEqual(p('/web/friendships/45/follow/'), { action: 'follow', id: '45' });
  assert.deepStrictEqual(p('/api/v1/friendships/remove_follower/7/'), { action: 'removeFollower', id: '7' });
  // The scanner's own list requests must not count as actions.
  assert.strictEqual(p('/api/v1/friendships/188295035/followers/?count=50'), null);
  assert.strictEqual(p('/api/v1/friendships/188295035/following/?count=50'), null);
});

test('applyLiveChange updates lists immediately and is idempotent', () => {
  const acct = {
    followers: ['1', '2'], following: ['2', '3'], events: [],
    users: { 1: { id: '1', u: 'a' }, 2: { id: '2', u: 'b' }, 3: { id: '3', u: 'c' }, 9: { id: '9', u: 'p', p: true } },
  };
  const a = applyLiveChange(acct, 'unfollow', '3', 50);
  assert.deepStrictEqual(a.following, ['2']);
  assert.deepStrictEqual(a.events[0], { t: 50, type: 'iUnfollowed', id: '3', live: true });
  assert.strictEqual(applyLiveChange(a, 'unfollow', '3', 51), null);

  const f = applyLiveChange(acct, 'follow', '1', 60);
  assert.deepStrictEqual(f.following, ['1', '2', '3']);
  assert.strictEqual(applyLiveChange(acct, 'follow', '999', 60), null); // unknown user
  assert.strictEqual(applyLiveChange(acct, 'follow', '9', 60), null); // private: only a request

  const r = applyLiveChange(acct, 'removeFollower', '1', 70);
  assert.deepStrictEqual(r.followers, ['2']);
  assert.strictEqual(r.events[0].type, 'iRemoved');

  // The next scan sees the same lists, so it doesn't log the unfollow twice.
  const { newEvents } = applyScan(a, { users: {}, followers: ['1', '2'], following: ['2'] }, 100);
  assert.strictEqual(newEvents.length, 0);
});

test('Hebrew and English have the same UI strings', () => {
  const { STRINGS, t } = require('../lib/i18n.js');
  assert.deepStrictEqual(Object.keys(STRINGS.he).sort(), Object.keys(STRINGS.en).sort());
  assert.match(t('unfollowError', { name: '@x', why: 'y' }), /@x.*y/);
});

test('parseFriendshipRequest recognises GraphQL follow mutations', () => {
  const { parseFriendshipRequest } = require('../lib/core.js');
  const body = (name, vars) => new URLSearchParams({ fb_api_req_friendly_name: name, variables: JSON.stringify(vars), doc_id: '1' }).toString();
  const g = 'https://www.instagram.com/graphql/query';
  assert.deepStrictEqual(parseFriendshipRequest(g, body('usePolarisUnfollowMutation', { target_user_id: '777' })), { action: 'unfollow', id: '777' });
  assert.deepStrictEqual(parseFriendshipRequest(g, body('usePolarisFollowMutation', { target_user_id: '778' })), { action: 'follow', id: '778' });
  assert.deepStrictEqual(parseFriendshipRequest(g, body('PolarisRemoveFollowerMutation', { input: { user_id: '779' } })), { action: 'removeFollower', id: '779' });
  assert.strictEqual(parseFriendshipRequest(g, body('PolarisProfilePageQuery', { id: '1234' })), null);
  // REST form still works without a body.
  assert.deepStrictEqual(parseFriendshipRequest('https://www.instagram.com/api/v1/friendships/destroy/5/', null), { action: 'unfollow', id: '5' });
});
