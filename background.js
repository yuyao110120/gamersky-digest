// background.js — 定时抓取、后台解析编排、badge、消息入口
import { fetchHomeHtml, fetchNewsEnrichment } from './lib/fetcher.js';
import * as store from './lib/store.js';

const REFRESH_ALARM = 'gamersky-refresh';
const REFRESH_MINUTES = 30;
const BADGE_COLOR = '#e8590c';

var refreshInFlight = null;

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

chrome.runtime.onInstalled.addListener(function (details) {
  setup();
  if (details && details.reason === 'install') {
    refresh('install').catch(function () {});
  }
});

chrome.runtime.onStartup.addListener(function () {
  setup();
});

async function setup() {
  try {
    var behavior = chrome.sidePanel && chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    if (behavior && behavior.catch) behavior.catch(function () {});
  } catch (err) { /* 忽略 */ }
  try {
    var alarm = await getAlarm(REFRESH_ALARM);
    if (!alarm) {
      chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_MINUTES });
    }
  } catch (err) { /* 忽略 */ }
  try {
    await store.ensureDefaults();
  } catch (err) { /* 忽略 */ }
}

function getAlarm(name) {
  return new Promise(function (resolve) {
    try {
      chrome.alarms.get(name, function (alarm) { resolve(alarm || null); });
    } catch (err) {
      resolve(null);
    }
  });
}

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm && alarm.name === REFRESH_ALARM) {
    refresh('alarm').catch(function () {});
  }
});

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || message.target !== 'background') return undefined;

  if (message.type === 'refresh-now') {
    refresh('manual')
      .then(function (result) { sendResponse({ ok: true, result: result }); })
      .catch(function (err) { sendResponse({ ok: false, error: String((err && err.message) || err) }); });
    return true;
  }

  if (message.type === 'panel-opened') {
    store.markSeen(Date.now())
      .then(async function (meta) {
        await applyBadge(0);
        sendResponse({ ok: true, meta: meta });
      })
      .catch(function (err) { sendResponse({ ok: false, error: String((err && err.message) || err) }); });
    return true;
  }

  if (message.type === 'clear-badge') {
    applyBadge(0).then(function () { sendResponse({ ok: true }); });
    return true;
  }

  return undefined;
});

function refresh(reason) {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = doRefresh(reason).finally(function () {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function doRefresh(reason) {
  var startedAt = Date.now();
  try {
    await store.patchMeta({ lastFetchAt: startedAt });
  } catch (err) { /* 忽略 */ }

  try {
    var results = await Promise.all([
      fetchHomeHtml(),
      fetchNewsEnrichment().catch(function () { return null; }),
    ]);
    var homeHtml = results[0];
    var newsText = results[1];

    var items = await parseInOffscreen(homeHtml, newsText);
    var now = Date.now();
    var applyResult = await store.applyFetch(items, now);
    var meta = await store.patchMeta({
      lastSuccessAt: now,
      consecutiveFailures: 0,
      lastError: null,
      lastFetchAt: startedAt,
    });
    await applyBadge(applyResult.newCount);
    notifyPanel({
      type: 'refresh-applied',
      newCount: applyResult.newCount,
      total: applyResult.items.length,
      meta: meta,
      reason: reason,
    });
    return { total: applyResult.items.length, newCount: applyResult.newCount };
  } catch (err) {
    var currentMeta;
    try {
      currentMeta = await store.getMeta();
    } catch (metaErr) {
      currentMeta = { consecutiveFailures: 0 };
    }
    var failures = (currentMeta.consecutiveFailures || 0) + 1;
    var lastError = {
      message: String((err && err.message) || err),
      type: (err && err.kind) || 'unknown',
      at: Date.now(),
    };
    var nextMeta = null;
    try {
      nextMeta = await store.patchMeta({ consecutiveFailures: failures, lastError: lastError });
    } catch (metaErr) { /* 忽略 */ }
    notifyPanel({
      type: 'refresh-failed',
      failures: failures,
      lastError: lastError,
      meta: nextMeta,
      reason: reason,
    });
    throw err;
  }
}

async function parseInOffscreen(homeHtml, newsText) {
  await ensureOffscreen();
  var response = await chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'parse-home',
    homeHtml: homeHtml,
    newsText: newsText || '',
  });
  if (!response || !response.ok) {
    var message = response && response.error ? response.error : '页面解析失败';
    var err = new Error(message);
    err.kind = 'parse';
    throw err;
  }
  return response.items || [];
}

async function ensureOffscreen() {
  var hasHasDocument = !!(chrome.offscreen && chrome.offscreen.hasDocument);
  if (hasHasDocument) {
    try {
      if (await chrome.offscreen.hasDocument()) return;
    } catch (err) { /* 忽略 */ }
  }
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['DOM_PARSER'],
      justification: '用 DOMParser 解析游民星空首页与新闻列表 HTML',
    });
  } catch (err) {
    var message = String((err && err.message) || err);
    if (!/single offscreen document|already/i.test(message)) throw err;
  }
  for (var attempt = 0; attempt < 25; attempt++) {
    try {
      var pong = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'ping' });
      if (pong && pong.ok) return;
    } catch (err) { /* 还没就绪 */ }
    await sleep(100);
  }
  throw new Error('后台解析文档未能启动');
}

async function applyBadge(count) {
  try {
    if (!count) {
      await chrome.action.setBadgeText({ text: '' });
      return;
    }
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
    await chrome.action.setBadgeText({ text: count > 99 ? '99+' : String(count) });
    if (chrome.action.setBadgeTextColor) {
      await chrome.action.setBadgeTextColor({ color: '#ffffff' });
    }
  } catch (err) { /* 忽略 */ }
}

function notifyPanel(message) {
  message.target = 'panel';
  try {
    var promise = chrome.runtime.sendMessage(message);
    if (promise && promise.catch) promise.catch(function () {});
  } catch (err) { /* 面板未打开 */ }
}
