import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeItems,
  countNewSinceLastSeen,
  pruneReadMap,
  pruneArticlesMap,
  READ_TTL_MS,
  ARTICLE_TTL_MS,
  ARTICLE_MAX_ENTRIES,
} from '../lib/store.js';

test('mergeItems：保留 firstSeenAt 与摘要，新条目记 now', () => {
  const existing = [
    { url: 'a', title: '旧标题', summary: '旧摘要', firstSeenAt: 1000, page: 1 },
  ];
  const incoming = [
    { url: 'a', title: '新标题', summary: '', headline: false, page: 1, order: 1, type: 'article' },
    { url: 'b', title: 'B', summary: '站点摘要', headline: true, page: 0, order: 2, type: 'article' },
  ];
  const merged = mergeItems(existing, incoming, 5000);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].title, '新标题');
  assert.equal(merged[0].summary, '旧摘要');
  assert.equal(merged[0].firstSeenAt, 1000);
  assert.equal(merged[1].firstSeenAt, 5000);
  assert.equal(merged[1].summary, '站点摘要');
});

test('countNewSinceLastSeen：只数 lastSeenAt 之后首次出现的条目', () => {
  const items = [
    { url: 'a', firstSeenAt: 100 },
    { url: 'b', firstSeenAt: 200 },
    { url: 'c', firstSeenAt: 50 },
  ];
  assert.equal(countNewSinceLastSeen(items, 150), 1);
  assert.equal(countNewSinceLastSeen(items, 0), 3);
  assert.equal(countNewSinceLastSeen(items, 300), 0);
});

test('pruneReadMap：只保留 7 天内的已读记录', () => {
  const now = 10 * READ_TTL_MS;
  const read = {
    fresh: now - 1000,
    stale: now - READ_TTL_MS - 1,
    broken: 'not-a-number',
  };
  assert.deepEqual(Object.keys(pruneReadMap(read, now)).sort(), ['fresh']);
});

test('pruneArticlesMap：TTL + LRU30', () => {
  const now = 100 * ARTICLE_TTL_MS;
  const cache = {};
  for (let i = 0; i < ARTICLE_MAX_ENTRIES + 8; i++) {
    cache['url' + i] = { article: { title: 't' + i }, fetchedAt: now - i * 1000 };
  }
  cache.ancient = { article: {}, fetchedAt: now - ARTICLE_TTL_MS - 1 };
  const pruned = pruneArticlesMap(cache, now);
  const keys = Object.keys(pruned);
  assert.equal(keys.length, ARTICLE_MAX_ENTRIES);
  assert.ok(!keys.includes('ancient'));
  assert.ok(keys.includes('url0'));
  assert.ok(!keys.includes('url' + (ARTICLE_MAX_ENTRIES + 7)));
});
