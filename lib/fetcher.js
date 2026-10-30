// lib/fetcher.js — 网络抓取（扩展页面里借助 host_permissions 跨域 fetch）
export class FetchError extends Error {
  constructor(message, kind, status) {
    super(message);
    this.name = 'FetchError';
    this.kind = kind || 'network';
    this.status = status || 0;
  }
}

export const HOME_URL = 'https://www.gamersky.com/';
export const ENRICH_ENDPOINT = 'https://db2.gamersky.com/LabelJsonpAjax.aspx';
export const ENRICH_NODE_ID = '11007';

export function buildEnrichUrl(page) {
  var jsondata = JSON.stringify({
    type: 'updatenodelabel',
    isCache: true,
    cacheTime: 60,
    nodeId: ENRICH_NODE_ID,
    isNodeId: 'true',
    page: page || 1,
  });
  return ENRICH_ENDPOINT + '?jsondata=' + encodeURIComponent(jsondata) + '&callback=cb';
}

export async function fetchText(url, options) {
  var opts = options || {};
  var timeoutMs = opts.timeoutMs || 15000;
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, timeoutMs);
  try {
    var response = await fetch(url, {
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal,
      headers: { 'Accept-Language': 'zh-CN,zh;q=0.9' },
    });
    if (!response.ok) {
      throw new FetchError('站点返回 HTTP ' + response.status, 'http', response.status);
    }
    return await response.text();
  } catch (err) {
    if (err instanceof FetchError) throw err;
    if (err && err.name === 'AbortError') throw new FetchError('请求超时', 'timeout');
    throw new FetchError('网络请求失败：' + String((err && err.message) || err), 'network');
  } finally {
    clearTimeout(timer);
  }
}

export function fetchHomeHtml() {
  return fetchText(HOME_URL, { timeoutMs: 20000 });
}

export function fetchNewsEnrichment() {
  return fetchText(buildEnrichUrl(1), { timeoutMs: 20000 });
}

export function fetchArticleHtml(url) {
  return fetchText(url, { timeoutMs: 20000 });
}
