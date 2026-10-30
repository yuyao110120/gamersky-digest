// lib/store.js — chrome.storage.local 读写 + 纯合并/裁剪函数
const KEY_META = 'meta';
const KEY_ITEMS = 'items';
const KEY_READ = 'read';
const KEY_ARTICLES = 'articles';
const KEY_PREFS = 'prefs';

export const KEY_NAMES = { META: KEY_META, ITEMS: KEY_ITEMS, READ: KEY_READ, ARTICLES: KEY_ARTICLES, PREFS: KEY_PREFS };

export const DEFAULT_META = {
  schemaVersion: 1,
  lastFetchAt: 0,
  lastSuccessAt: 0,
  lastSeenAt: 0,
  consecutiveFailures: 0,
  lastError: null,
};

export const DEFAULT_PREFS = { theme: 'auto', fontSize: 'm' };

export const READ_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const ARTICLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const ARTICLE_MAX_ENTRIES = 30;

function hasStorage() {
  return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
}

function requireStorage() {
  if (!hasStorage()) throw new Error('chrome.storage.local 不可用');
}

async function readRaw(keys) {
  requireStorage();
  return new Promise(function (resolve, reject) {
    chrome.storage.local.get(keys, function (data) {
      var err = chrome.runtime && chrome.runtime.lastError;
      if (err) reject(new Error(err.message)); else resolve(data || {});
    });
  });
}

async function writeRaw(patch) {
  requireStorage();
  return new Promise(function (resolve, reject) {
    chrome.storage.local.set(patch, function () {
      var err = chrome.runtime && chrome.runtime.lastError;
      if (err) reject(new Error(err.message)); else resolve();
    });
  });
}

export async function ensureDefaults() {
  var data = await readRaw([KEY_META, KEY_ITEMS, KEY_READ, KEY_ARTICLES, KEY_PREFS]);
  var patch = {};
  patch[KEY_META] = Object.assign({}, DEFAULT_META, data[KEY_META] || {});
  if (!Array.isArray(data[KEY_ITEMS])) patch[KEY_ITEMS] = [];
  if (!data[KEY_READ] || typeof data[KEY_READ] !== 'object') patch[KEY_READ] = {};
  if (!data[KEY_ARTICLES] || typeof data[KEY_ARTICLES] !== 'object') patch[KEY_ARTICLES] = {};
  patch[KEY_PREFS] = Object.assign({}, DEFAULT_PREFS, data[KEY_PREFS] || {});
  await writeRaw(patch);
  return patch;
}

export async function loadAll() {
  var data = await readRaw([KEY_META, KEY_ITEMS, KEY_READ, KEY_ARTICLES, KEY_PREFS]);
  return {
    meta: Object.assign({}, DEFAULT_META, data[KEY_META] || {}),
    items: Array.isArray(data[KEY_ITEMS]) ? data[KEY_ITEMS] : [],
    read: data[KEY_READ] && typeof data[KEY_READ] === 'object' ? data[KEY_READ] : {},
    articles: data[KEY_ARTICLES] && typeof data[KEY_ARTICLES] === 'object' ? data[KEY_ARTICLES] : {},
    prefs: Object.assign({}, DEFAULT_PREFS, data[KEY_PREFS] || {}),
  };
}

export async function getMeta() {
  var data = await readRaw([KEY_META]);
  return Object.assign({}, DEFAULT_META, data[KEY_META] || {});
}

export async function patchMeta(patch) {
  var meta = await getMeta();
  Object.assign(meta, patch || {});
  await writeRaw({ meta: meta });
  return meta;
}

export async function getItems() {
  var data = await readRaw([KEY_ITEMS]);
  return Array.isArray(data[KEY_ITEMS]) ? data[KEY_ITEMS] : [];
}

export async function getRead() {
  var data = await readRaw([KEY_READ]);
  return data[KEY_READ] && typeof data[KEY_READ] === 'object' ? data[KEY_READ] : {};
}

export async function getPrefs() {
  var data = await readRaw([KEY_PREFS]);
  return Object.assign({}, DEFAULT_PREFS, data[KEY_PREFS] || {});
}

export async function savePrefs(prefs) {
  var merged = Object.assign({}, await getPrefs(), prefs || {});
  await writeRaw({ prefs: merged });
  return merged;
}

// ---------- 纯函数（可单测） ----------

export function mergeItems(existingItems, incomingItems, now) {
  var previous = {};
  (existingItems || []).forEach(function (item) {
    if (item && item.url) previous[item.url] = item;
  });
  return (incomingItems || []).map(function (item) {
    var prev = previous[item.url];
    return {
      url: item.url,
      title: item.title,
      timeText: item.timeText || '',
      headline: !!item.headline,
      page: item.page || 0,
      order: item.order || 0,
      type: item.type || 'article',
      firstSeenAt: (prev && prev.firstSeenAt) || now,
    };
  });
}

export function countNewSinceLastSeen(items, lastSeenAt) {
  var last = lastSeenAt || 0;
  var count = 0;
  (items || []).forEach(function (item) {
    if ((item.firstSeenAt || 0) > last) count += 1;
  });
  return count;
}

export function pruneReadMap(readMap, now) {
  var out = {};
  var keys = Object.keys(readMap || {});
  for (var i = 0; i < keys.length; i++) {
    var ts = readMap[keys[i]];
    if (typeof ts === 'number' && now - ts <= READ_TTL_MS) out[keys[i]] = ts;
  }
  return out;
}

export function pruneArticlesMap(cacheMap, now) {
  var entries = [];
  Object.keys(cacheMap || {}).forEach(function (url) {
    var entry = cacheMap[url];
    if (!entry) return;
    if (now - (entry.fetchedAt || 0) > ARTICLE_TTL_MS) return;
    entries.push({ url: url, entry: entry });
  });
  entries.sort(function (a, b) { return (b.entry.fetchedAt || 0) - (a.entry.fetchedAt || 0); });
  var out = {};
  entries.slice(0, ARTICLE_MAX_ENTRIES).forEach(function (row) { out[row.url] = row.entry; });
  return out;
}

export async function applyFetch(incomingItems, now) {
  var data = await readRaw([KEY_ITEMS, KEY_META]);
  var merged = mergeItems(data[KEY_ITEMS], incomingItems, now);
  var meta = Object.assign({}, DEFAULT_META, data[KEY_META] || {});
  var newCount = countNewSinceLastSeen(merged, meta.lastSeenAt);
  await writeRaw({ items: merged });
  await pruneRead(now);
  return { items: merged, newCount: newCount };
}

export async function markSeen(now) {
  var meta = await patchMeta({ lastSeenAt: now });
  return meta;
}

export async function markRead(url, now) {
  var read = await getRead();
  read[url] = now;
  await writeRaw({ read: pruneReadMap(read, now) });
  return read;
}

export async function markAllRead(items, now) {
  var read = await getRead();
  (items || []).forEach(function (item) { if (item && item.url) read[item.url] = now; });
  read = pruneReadMap(read, now);
  await writeRaw({ read: read });
  return read;
}

export async function pruneRead(now) {
  var read = await getRead();
  var pruned = pruneReadMap(read, now);
  await writeRaw({ read: pruned });
  return pruned;
}

export async function getCachedArticle(url) {
  var data = await readRaw([KEY_ARTICLES]);
  var cache = data[KEY_ARTICLES] || {};
  var entry = cache[url];
  if (!entry) return null;
  if (Date.now() - (entry.fetchedAt || 0) > ARTICLE_TTL_MS) return null;
  return entry.article || null;
}

export async function cacheArticle(url, article, now) {
  var data = await readRaw([KEY_ARTICLES]);
  var cache = data[KEY_ARTICLES] || {};
  cache[url] = { article: article, fetchedAt: now };
  cache = pruneArticlesMap(cache, now);
  await writeRaw({ articles: cache });
  return cache;
}
