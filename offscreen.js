// offscreen.js — 后台 DOM 解析宿主（Service Worker 里没有 DOMParser）
import { parseHomePage } from './lib/parser.js';

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || message.target !== 'offscreen') return undefined;

  if (message.type === 'ping') {
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'parse-home') {
    try {
      var result = parseHomePage(message.homeHtml);
      sendResponse({ ok: true, items: result.items, meta: result.meta });
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
