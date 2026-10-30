// offscreen.js — 后台 DOM 解析宿主（Service Worker 里没有 DOMParser）
import { parseHomePage, parseNewsJsonp } from './lib/parser.js';

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || message.target !== 'offscreen') return undefined;

  if (message.type === 'ping') {
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'parse-home') {
    try {
      var result = parseHomePage(message.homeHtml);
      var enrich = {};
      if (message.newsText) {
        try {
          enrich = parseNewsJsonp(message.newsText);
        } catch (err) {
          enrich = {};
        }
      }
      var items = result.items.map(function (item) {
        var extra = enrich[item.url];
        if (extra) {
          if (extra.summary) item.summary = extra.summary;
          if (extra.timeText) item.newsTimeText = extra.timeText;
        }
        return item;
      });
      sendResponse({ ok: true, items: items, meta: result.meta });
    } catch (err) {
      sendResponse({
        ok: false,
        error: String((err && err.message) || err),
        code: (err && err.code) || 'parse-failed',
      });
    }
    return true;
  }

  return undefined;
});
