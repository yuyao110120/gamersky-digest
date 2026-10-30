// lib/parser.js — 游民星空页面解析（纯函数；依赖 DOMParser，可在侧边栏 / offscreen / Node+jsdom 运行）
export const HOME_PAGE_URL = 'https://www.gamersky.com/';

export class ParserError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ParserError';
    this.code = code || 'parse-failed';
    this.kind = 'parse';
  }
}

const BOILERPLATE_PATTERNS = [
  /^本文由游民星空制作发布/,
  /^更多相关资讯请关注/,
  /^（完）$/,
  /^loading$/i,
];

const MEDIA_TAGS = {
  script: true, style: true, iframe: true, img: true,
  noscript: true, video: true, audio: true, embed: true, object: true,
};

function stripInlineHandlers(markup) {
  // Chrome 在 DOMParser 解析到 onclick 等属性时，会向扩展页抛 "inline event handler
  // 违反 CSP" 的日志；我们本来也不执行站点脚本，解析前直接去掉这类属性保持控制台干净。
  return String(markup == null ? '' : markup).replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

function makeDocument(html) {
  if (typeof DOMParser === 'undefined') {
    throw new ParserError('当前环境没有 DOMParser', 'no-dom');
  }
  return new DOMParser().parseFromString(stripInlineHandlers(html), 'text/html');
}

export function normalizeText(value) {
  return String(value == null ? '' : value)
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

var TRACKING_PARAMS = [
  'toutiao',
  'spm_id_from',
  'vd_source',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
];

function stripTrackingParams(url) {
  if (!url.search) return;
  var query = url.search.slice(1);
  if (!query) return;
  var kept = [];
  var parts = query.split('&');
  for (var i = 0; i < parts.length; i++) {
    if (!parts[i]) continue;
    var name = parts[i].split('=')[0];
    var decoded = name;
    try {
      decoded = decodeURIComponent(name);
    } catch (err) { /* 保留原串 */ }
    if (TRACKING_PARAMS.indexOf(decoded.toLowerCase()) !== -1) continue;
    kept.push(parts[i]);
  }
  url.search = kept.length ? '?' + kept.join('&') : '';
}

export function canonicalizeUrl(href, base) {
  var raw = String(href == null ? '' : href).trim();
  if (!raw || raw.charAt(0) === '#') return null;
  if (/^javascript:/i.test(raw)) return null;
  var url;
  try {
    url = new URL(raw, base || HOME_PAGE_URL);
  } catch (err) {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.hash = '';
  // 专题页的 topicId、社区的 club 等业务参数必须保留，否则「打开原文」会落到错误页面；
  // 只剔除明显的统计参数（如头条链接上的 ?toutiao）。
  stripTrackingParams(url);
  if (url.hostname === 'gamersky.com') url.hostname = 'www.gamersky.com';
  if (url.hostname === 'www.gamersky.com') url.protocol = 'https:';
  return url.href;
}

export function classifyUrl(url) {
  var parsed;
  try {
    parsed = new URL(url);
  } catch (err) {
    return 'external';
  }
  var host = parsed.hostname.toLowerCase();
  var path = parsed.pathname;
  if (host === 'club.gamersky.com') return 'community';
  var isTopicPath = path.indexOf('/zt/') === 0 || path.indexOf('/zhuanti/') === 0;
  if (host === 'www.gamersky.com' || host === 'gamersky.com') {
    if (isTopicPath) return 'topic';
    if (/\/\d{6}\/\d+(?:_\d+)?\.shtml$/.test(path)) return 'article';
    return 'external';
  }
  if (/\.gamersky\.com$/.test(host)) {
    if (isTopicPath) return 'topic';
    return 'external';
  }
  return 'external';
}

function canonicalImageSrc(src) {
  var raw = String(src == null ? '' : src).trim();
  if (!raw || /^data:/i.test(raw)) return null;
  // 站点的懒加载占位图（blank.png / loading.gif 之类）不能当正文图片
  if (/loading\.(gif|png|jpe?g)|blank\.(gif|png|jpe?g)|spacer|transparent|1x1|pixel\.(gif|png)/i.test(raw)) return null;
  try {
    var url = new URL(raw, HOME_PAGE_URL);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.href;
  } catch (err) {
    return null;
  }
}

// 正文图片可能是懒加载：真实地址常放在 data-src / data-origin / data-large 等属性里，
// src 只是 blank.png 占位。按优先级逐个尝试。
function resolveImageSrc(img) {
  var pictype = String(img.getAttribute('data-pictype') || '').toLowerCase();
  var originSrc = canonicalImageSrc(img.getAttribute('data-origin')) || canonicalImageSrc(img.getAttribute('data-large'));
  // 站点把动图的「原图（会动）」放在 data-origin / data-large；
  // data-src / data-small 往往只是同一张图的静态预览帧，点了也看不到动画。
  if (originSrc && (pictype === 'gif' || /\.gif(\?|$)/i.test(originSrc))) return originSrc;
  var attrs = ['data-src', 'data-original', 'data-small', 'data-large', 'data-origin', 'sourceimageurl', '_cke_saved_src', 'src'];
  for (var i = 0; i < attrs.length; i++) {
    var src = canonicalImageSrc(img.getAttribute(attrs[i]));
    if (src) return src;
  }
  return null;
}

function textWithoutMedia(el) {
  var parts = [];
  function walk(node) {
    for (var child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 3) {
        parts.push(child.nodeValue);
        continue;
      }
      if (child.nodeType !== 1) continue;
      var tag = child.tagName.toLowerCase();
      if (MEDIA_TAGS[tag]) continue;
      walk(child);
    }
  }
  walk(el);
  return normalizeText(parts.join(''));
}

function extractRuns(el) {
  var runs = [];
  var buffer = '';
  function flush() {
    var text = normalizeText(buffer);
    buffer = '';
    if (text) runs.push({ text: text });
  }
  function walk(node) {
    for (var child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 3) {
        buffer += child.nodeValue;
        continue;
      }
      if (child.nodeType !== 1) continue;
      var tag = child.tagName.toLowerCase();
      if (MEDIA_TAGS[tag]) continue;
      if (tag === 'a') {
        var href = canonicalizeUrl(child.getAttribute('href'), HOME_PAGE_URL);
        var linkText = normalizeText(child.textContent);
        if (href && linkText) {
          flush();
          runs.push({ text: linkText, href: href });
        } else {
          buffer += child.textContent || '';
        }
        continue;
      }
      walk(child);
    }
  }
  walk(el);
  flush();
  return runs;
}

function extractImages(el, seen) {
  var images = [];
  var nodes = el.querySelectorAll('img');
  for (var i = 0; i < nodes.length; i++) {
    var img = nodes[i];
    var src = resolveImageSrc(img);
    if (!src || seen[src]) continue;
    seen[src] = true;
    var linkEl = img.closest ? img.closest('a') : null;
    var animated = /\.gif(\?|$)/i.test(src) || String(img.getAttribute('data-pictype') || '').toLowerCase() === 'gif';
    images.push({
      type: 'image',
      src: src,
      alt: normalizeText(img.getAttribute('alt')),
      animated: animated,
      link: linkEl ? (canonicalizeUrl(linkEl.getAttribute('href'), HOME_PAGE_URL) || '') : '',
    });
  }
  return images;
}

function extractVideos(el) {
  var videos = [];
  var seen = {};
  var scripts = el.querySelectorAll('script');
  var pattern = /gsVideo\s*\(\s*(["'])([\s\S]*?)\1\s*,\s*(["'])([\s\S]*?)\3\s*\)/g;
  for (var i = 0; i < scripts.length; i++) {
    var code = scripts[i].textContent || '';
    var match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(code)) !== null) {
      var url = String(match[4] || '').trim();
      if (!url || seen[url]) continue;
      seen[url] = true;
      videos.push({ type: 'video', platform: normalizeText(match[2]), url: url });
    }
  }
  return videos;
}

function isBoilerplate(text) {
  for (var i = 0; i < BOILERPLATE_PATTERNS.length; i++) {
    if (BOILERPLATE_PATTERNS[i].test(text)) return true;
  }
  return false;
}

function parseDetailText(detailText) {
  var text = normalizeText(detailText).replace(/loading$/i, '');
  var meta = { timeText: '', source: '', author: '', editor: '' };
  var timeMatch = text.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?)/);
  if (timeMatch) meta.timeText = timeMatch[1].replace(/\s+/, ' ');
  var sourceMatch = text.match(/来源[：:]\s*([^\s]+)/);
  if (sourceMatch) meta.source = sourceMatch[1];
  var authorMatch = text.match(/作者[：:]\s*(.+?)(?=\s*编辑[：:]|$)/);
  if (authorMatch) meta.author = authorMatch[1].trim();
  var editorMatch = text.match(/编辑[：:]\s*([^\s]+)/);
  if (editorMatch) meta.editor = editorMatch[1];
  return meta;
}

function extractBlocks(bodyEl) {
  var blocks = [];
  var seenImages = {};
  var paragraphs = bodyEl.querySelectorAll('p');
  for (var i = 0; i < paragraphs.length; i++) {
    var p = paragraphs[i];
    var videos = extractVideos(p);
    var images = extractImages(p, seenImages);
    var runs = extractRuns(p);
    var text = textWithoutMedia(p);
    if (runs.length && text && !isBoilerplate(text) && text !== '视频：' && text !== '视频:') {
      blocks.push({ type: 'text', text: text, runs: runs });
    } else if (text && !isBoilerplate(text) && text !== '视频：' && text !== '视频:' && !videos.length && !images.length) {
      blocks.push({ type: 'text', text: text, runs: [] });
    }
    for (var v = 0; v < videos.length; v++) blocks.push(videos[v]);
    for (var im = 0; im < images.length; im++) blocks.push(images[im]);
  }
  return blocks;
}

export function extractPageUrls(doc, currentUrl) {
  // 站点把分页链接放在 .pagecss 里，但该 span 内含 div，部分解析器会重排结构；
  // 所以直接扫描全页锚点，再按「同一文章 stem + _页码」过滤，稳一点。
  var anchors = doc.querySelectorAll('a[href]');
  var current = canonicalizeUrl(currentUrl || '', HOME_PAGE_URL) || '';
  var stemMatch = current.match(/^(.*?)(?:_(\d+))?\.shtml$/);
  if (!stemMatch) return [];
  var stem = stemMatch[1];
  var currentPage = stemMatch[2] ? parseInt(stemMatch[2], 10) : 1;
  var pages = {};
  for (var i = 0; i < anchors.length; i++) {
    var abs = canonicalizeUrl(anchors[i].getAttribute('href'), currentUrl || HOME_PAGE_URL);
    if (!abs) continue;
    var match = abs.match(/^(.*?)(?:_(\d+))?\.shtml$/);
    if (!match || match[1] !== stem) continue;
    var pageNo = match[2] ? parseInt(match[2], 10) : 1;
    if (!pages[pageNo]) pages[pageNo] = abs;
  }
  var result = [];
  Object.keys(pages).forEach(function (key) {
    var pageNo = parseInt(key, 10);
    if (pageNo > currentPage) result.push({ page: pageNo, url: pages[key] });
  });
  result.sort(function (a, b) { return a.page - b.page; });
  return result;
}

export function parseHomePage(html) {
  var doc = makeDocument(html);
  var scope = doc.querySelector('#Index_Mid1') || doc.querySelector('.Mid1') || doc;

  var modules = scope.querySelectorAll('.Mid1M');
  if (!modules.length) modules = doc.querySelectorAll('.Mid1M');
  var module = null;
  for (var i = 0; i < modules.length; i++) {
    var nav = modules[i].querySelector('.Mid1Mnav');
    if (nav && normalizeText(nav.textContent).indexOf('今日要闻') !== -1) {
      module = modules[i];
      break;
    }
  }
  if (!module) module = modules.length ? modules[0] : scope;

  var container = module.querySelector('.Mid1Mcon.block') || module.querySelector('.Mid1Mcon');
  if (!container) {
    throw new ParserError('未找到「今日要闻」模块容器，站点可能已改版', 'home-module-not-found');
  }

  var items = [];
  var seen = {};
  function push(item) {
    if (!item.url || seen[item.url] || !item.title) return;
    seen[item.url] = true;
    item.order = items.length + 1;
    item.firstSeenAt = 0;
    items.push(item);
  }

  var featured = container.querySelectorAll('ul.bgx a');
  for (var f = 0; f < featured.length; f++) {
    var featuredUrl = canonicalizeUrl(featured[f].getAttribute('href'), HOME_PAGE_URL);
    var featuredTitle = normalizeText(featured[f].textContent);
    if (!featuredUrl || !featuredTitle) continue;
    push({
      url: featuredUrl,
      title: featuredTitle,
      timeText: '',
      headline: true,
      page: 0,
      type: classifyUrl(featuredUrl),
    });
  }

  var lists = container.querySelectorAll('ul.Ptxt');
  var listPages = 0;
  for (var l = 0; l < lists.length; l++) {
    var entries = lists[l].querySelectorAll('li.li3');
    if (!entries.length) continue;
    listPages += 1;
    for (var e = 0; e < entries.length; e++) {
      var entry = entries[e];
      var anchor = entry.querySelector('a[href]');
      if (!anchor) continue;
      var url = canonicalizeUrl(anchor.getAttribute('href'), HOME_PAGE_URL);
      if (!url) continue;
      var title = normalizeText(anchor.textContent);
      if (!title) continue;
      var timeEl = entry.querySelector('.time');
      push({
        url: url,
        title: title,
        timeText: timeEl ? normalizeText(timeEl.textContent) : '',
        headline: false,
        page: listPages,
        type: classifyUrl(url),
      });
    }
  }

  if (!items.length) {
    throw new ParserError('「今日要闻」模块里没有解析到条目，站点结构可能已变化', 'home-empty');
  }

  var featuredCount = 0;
  for (var c = 0; c < items.length; c++) if (items[c].headline) featuredCount += 1;
  return {
    items: items,
    meta: { featuredCount: featuredCount, listPages: listPages, total: items.length },
  };
}

export function parseArticlePage(html, url) {
  var doc = makeDocument(html);

  var redirectEl = doc.querySelector('#redirectTips[data-link]');
  if (redirectEl) {
    return {
      kind: 'redirect',
      targetUrl: canonicalizeUrl(redirectEl.getAttribute('data-link'), url || HOME_PAGE_URL) || '',
      title: normalizeText((doc.querySelector('title') || {}).textContent || ''),
    };
  }

  // 游民圈子（club.gamersky.com）社区帖：结构完全不同，单独适配
  var clubBodyEl = doc.querySelector('.qzcmt-content-txt.GSContent') ||
    doc.querySelector('.qzcmt-content-txt.EditableArea') ||
    doc.querySelector('.qzcmt-content');
  if (clubBodyEl) {
    var clubTitleEl = doc.querySelector('.qzcmt-tit h3') || doc.querySelector('.qzcmt-tit');
    var fallbackTitle = normalizeText((doc.querySelector('title') || {}).textContent || '');
    fallbackTitle = fallbackTitle.replace(/_[^_]*\|[^|]*$/, '');
    var clubTimeEl = doc.querySelector('.qzcmt-user a.time') || doc.querySelector('.qzcmt-user .time');
    var clubAuthorEl = doc.querySelector('.qzcmt-user .uname');
    return {
      kind: 'article',
      url: url || '',
      title: normalizeText(clubTitleEl ? clubTitleEl.textContent : fallbackTitle),
      meta: {
        timeText: normalizeText(clubTimeEl ? clubTimeEl.textContent : ''),
        source: '游民圈子',
        author: normalizeText(clubAuthorEl ? clubAuthorEl.textContent : ''),
        editor: '',
      },
      blocks: extractBlocks(clubBodyEl),
      pageUrls: [],
    };
  }

  var titleEl = doc.querySelector('.Mid2L_tit h1') || doc.querySelector('h1');
  var bodyEl = doc.querySelector('.Mid2L_ctt.block .Mid2L_con') || doc.querySelector('.Mid2L_con');
  if (!titleEl || !bodyEl) {
    throw new ParserError('文章正文结构未找到，站点模板可能已变化', 'article-structure-not-found');
  }

  var detailEl = doc.querySelector('.Mid2L_tit .detail');
  var meta = parseDetailText(detailEl ? detailEl.textContent : '');
  var blocks = extractBlocks(bodyEl);
  var pageUrls = extractPageUrls(doc, url);

  return {
    kind: 'article',
    url: url || '',
    title: normalizeText(titleEl.textContent),
    meta: meta,
    blocks: blocks,
    pageUrls: pageUrls,
  };
}
