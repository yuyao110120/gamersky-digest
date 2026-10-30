// sidepanel.js — 侧边栏：列表 / 文章两视图
import * as store from './lib/store.js';
import * as fmt from './lib/format.js';
import { parseArticlePage } from './lib/parser.js';
import { fetchArticleHtml } from './lib/fetcher.js';

var PAGE_BATCH_SIZE = 5;
var SITE_URL = 'https://www.gamersky.com/';

var state = {
  items: [],
  meta: null,
  read: {},
  prefs: null,
  view: 'list',
  expandedPages: 1,
  listScroll: 0,
  articleItem: null,
  articleUrl: '',
  article: null,
  articleLoading: false,
  articleError: '',
  articleNotice: null,
  refreshing: false,
  updateCount: 0,
  manualError: '',
  toastTimer: 0,
};

var els = {};

function $(id) {
  return document.getElementById(id);
}

function el(tag, className, text) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function cacheElements() {
  els.today = $('today');
  els.statusline = $('statusline');
  els.banner = $('banner');
  els.updateBar = $('update-bar');
  els.updateCount = $('update-count');
  els.btnUpdate = $('btn-update');
  els.list = $('list');
  els.listFooter = $('list-footer');
  els.viewList = $('view-list');
  els.viewArticle = $('view-article');
  els.article = $('article');
  els.btnRefresh = $('btn-refresh');
  els.btnMenu = $('btn-menu');
  els.btnBack = $('btn-back');
  els.btnOriginal = $('btn-original');
  els.menu = $('menu');
  els.segTheme = $('seg-theme');
  els.segFont = $('seg-font');
  els.btnMarkAll = $('btn-mark-all');
  els.btnOpenSite = $('btn-open-site');
  els.toast = $('toast');
}

function setSegActive(seg, attr, value) {
  if (!seg) return;
  var buttons = seg.querySelectorAll('button');
  for (var i = 0; i < buttons.length; i++) {
    buttons[i].classList.toggle('active', buttons[i].getAttribute(attr) === value);
  }
}

function applyPrefs() {
  var prefs = state.prefs || { theme: 'auto', fontSize: 'm' };
  document.documentElement.setAttribute('data-theme', prefs.theme || 'auto');
  document.documentElement.setAttribute('data-size', prefs.fontSize || 'm');
  setSegActive(els.segTheme, 'data-theme', prefs.theme || 'auto');
  setSegActive(els.segFont, 'data-size', prefs.fontSize || 'm');
}

async function setPrefs(patch) {
  state.prefs = Object.assign({}, state.prefs || {}, patch);
  applyPrefs();
  try {
    state.prefs = await store.savePrefs(state.prefs);
  } catch (err) { /* 忽略 */ }
}

async function init() {
  cacheElements();
  try {
    state.prefs = await store.getPrefs();
  } catch (err) {
    state.prefs = { theme: 'auto', fontSize: 'm' };
  }
  applyPrefs();
  await loadState();
  bindEvents();
  chrome.runtime.onMessage.addListener(onRuntimeMessage);
  window.addEventListener('online', renderBanner);
  window.addEventListener('offline', renderBanner);
  els.today.textContent = fmt.todayLabel();
  render();
  try {
    var response = await chrome.runtime.sendMessage({ target: 'background', type: 'panel-opened' });
    if (response && response.ok && response.meta) {
      state.meta = response.meta;
      renderStatus();
      renderBanner();
    }
  } catch (err) { /* 后台未就绪 */ }
  await maybeRefresh();
}

async function loadState() {
  var data = await store.loadAll();
  state.items = data.items;
  state.meta = data.meta;
  state.read = data.read;
  state.prefs = Object.assign({}, state.prefs || {}, data.prefs);
  var maxPage = 1;
  for (var i = 0; i < state.items.length; i++) {
    var page = state.items[i].page || 0;
    if (page > maxPage) maxPage = page;
  }
  if (state.expandedPages > maxPage) state.expandedPages = maxPage;
  if (state.expandedPages < 1) state.expandedPages = 1;
}

function bindEvents() {
  els.btnRefresh.addEventListener('click', function () {
    requestRefresh();
  });
  els.btnMenu.addEventListener('click', function (event) {
    event.stopPropagation();
    toggleMenu();
  });
  els.btnUpdate.addEventListener('click', onUpdateClick);
  els.btnBack.addEventListener('click', goBack);
  els.btnOriginal.addEventListener('click', function () {
    if (state.articleItem) openExternal(state.articleItem.url);
  });
  els.segTheme.addEventListener('click', function (event) {
    var target = event.target.closest ? event.target.closest('button[data-theme]') : null;
    if (!target) return;
    setPrefs({ theme: target.getAttribute('data-theme') });
  });
  els.segFont.addEventListener('click', function (event) {
    var target = event.target.closest ? event.target.closest('button[data-size]') : null;
    if (!target) return;
    setPrefs({ fontSize: target.getAttribute('data-size') });
  });
  els.btnMarkAll.addEventListener('click', markAllRead);
  els.btnOpenSite.addEventListener('click', function () {
    closeMenu();
    openExternal(SITE_URL);
  });
  document.addEventListener('click', function (event) {
    if (els.menu.hidden) return;
    if (els.menu.contains(event.target) || els.btnMenu.contains(event.target)) return;
    closeMenu();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    if (!els.menu.hidden) {
      closeMenu();
      return;
    }
    if (state.view === 'article') goBack();
  });
}

function toggleMenu() {
  els.menu.hidden = !els.menu.hidden;
}

function closeMenu() {
  els.menu.hidden = true;
}

async function maybeRefresh() {
  var lastSuccess = (state.meta && state.meta.lastSuccessAt) || 0;
  var stale = Date.now() - lastSuccess > 10 * 60 * 1000;
  if (!state.items.length || stale) await requestRefresh();
}

async function requestRefresh() {
  if (state.refreshing) return;
  state.refreshing = true;
  state.manualError = '';
  renderStatus();
  renderList();
  try {
    var response = await chrome.runtime.sendMessage({ target: 'background', type: 'refresh-now' });
    if (!response || !response.ok) {
      state.manualError = (response && response.error) || '刷新失败';
    } else {
      await loadState();
      hideUpdateBar();
      clearBadge();
    }
  } catch (err) {
    state.manualError = String((err && err.message) || err);
  }
  state.refreshing = false;
  await loadState();
  render();
}

function onRuntimeMessage(message) {
  if (!message || message.target !== 'panel') return;
  if (message.type === 'refresh-applied') {
    if (message.meta) state.meta = message.meta;
    if (state.refreshing) return;
    if (message.newCount > 0 && state.view === 'list') {
      state.updateCount = message.newCount;
      showUpdateBar();
    }
    if (!state.items.length) {
      loadState().then(function () { render(); });
    }
    renderStatus();
    renderBanner();
    return;
  }
  if (message.type === 'refresh-failed') {
    if (message.meta) state.meta = message.meta;
    renderStatus();
    renderBanner();
  }
}

function clearBadge() {
  try {
    var promise = chrome.runtime.sendMessage({ target: 'background', type: 'clear-badge' });
    if (promise && promise.catch) promise.catch(function () {});
  } catch (err) { /* 忽略 */ }
}

function showUpdateBar() {
  els.updateBar.hidden = false;
  els.updateCount.textContent = String(state.updateCount || 0);
}

function hideUpdateBar() {
  state.updateCount = 0;
  els.updateBar.hidden = true;
}

async function onUpdateClick() {
  var scroll = els.list.scrollTop;
  hideUpdateBar();
  await loadState();
  render();
  els.list.scrollTop = scroll;
  clearBadge();
}

function render() {
  renderStatus();
  renderBanner();
  if (state.view === 'article') {
    els.viewList.hidden = true;
    els.viewArticle.hidden = false;
    renderArticle();
  } else {
    els.viewArticle.hidden = true;
    els.viewList.hidden = false;
    renderList();
  }
}

function renderStatus() {
  var meta = state.meta || {};
  var parts = [];
  parts.push(state.refreshing ? '更新中…' : fmt.formatUpdatedAt(meta.lastSuccessAt));
  if (state.items.length) parts.push(state.items.length + ' 条');
  els.statusline.textContent = parts.join(' · ');
  els.btnRefresh.classList.toggle('spinning', !!state.refreshing);
  els.btnRefresh.disabled = !!state.refreshing;
}

function renderBanner() {
  var meta = state.meta || {};
  var failures = meta.consecutiveFailures || 0;
  var error = meta.lastError || null;
  var message = '';
  var kind = '';
  if (!navigator.onLine) {
    message = '离线 · 显示的是本地缓存' + (meta.lastSuccessAt ? '（' + fmt.formatClock(meta.lastSuccessAt) + '）' : '');
    kind = 'warn';
  } else if (state.manualError) {
    message = '刷新失败：' + state.manualError;
    kind = 'error';
  } else if (failures >= 5) {
    message = (error && error.type === 'parse' ? '解析可能已失效（站点可能改版），' : '连续抓取失败，') + '当前显示的是上次成功的数据。';
    kind = 'error';
  } else if (failures >= 2) {
    message = '数据可能不是最新（已连续 ' + failures + ' 次抓取失败）。';
    kind = 'warn';
  }
  if (!message) {
    els.banner.hidden = true;
    els.banner.textContent = '';
    els.banner.className = 'banner';
    return;
  }
  els.banner.hidden = false;
  els.banner.className = 'banner ' + kind;
  els.banner.textContent = '';
  els.banner.appendChild(el('span', 'banner-text', message));
  if (failures >= 2 || state.manualError) {
    var retry = el('button', 'banner-btn', '重试');
    retry.type = 'button';
    retry.addEventListener('click', function () { requestRefresh(); });
    els.banner.appendChild(retry);
  }
  if (failures >= 5 || state.manualError) {
    var site = el('a', 'banner-btn', '打开站点');
    site.href = SITE_URL;
    site.target = '_blank';
    site.rel = 'noreferrer';
    els.banner.appendChild(site);
  }
}

function makeSectionLabel(text, isHeadline) {
  return el('div', 'section-label' + (isHeadline ? ' headline' : ''), text);
}

function makeDivider(text) {
  return el('div', 'new-divider', text);
}

function makeSkeleton() {
  var wrap = el('div', 'skeleton-wrap');
  wrap.appendChild(el('div', 'skeleton title'));
  wrap.appendChild(el('div', 'skeleton line'));
  return wrap;
}

function typeLabel(type) {
  if (type === 'topic') return '专题';
  if (type === 'community') return '社区';
  if (type === 'external') return '站外';
  return '';
}

function attachTitleScroller(itemEl, titleWrap, titleText) {
  function measureOverflow() {
    // 默认状态标题被 max-width:100% 裁掉并显示省略号，scrollWidth 等于可见宽度；
    // 测量时临时放开限制，拿到整段文字的宽度。
    var previousMaxWidth = titleText.style.maxWidth;
    titleText.style.maxWidth = 'none';
    var distance = titleText.scrollWidth - titleWrap.clientWidth;
    titleText.style.maxWidth = previousMaxWidth;
    return distance;
  }
  itemEl.addEventListener('mouseenter', function () {
    var distance = measureOverflow();
    if (distance <= 2) return;
    titleText.style.setProperty('--scroll-distance', '-' + distance + 'px');
    titleText.style.setProperty('--scroll-duration', Math.max(900, Math.round(distance * 14)) + 'ms');
    titleWrap.classList.add('marquee');
  });
  itemEl.addEventListener('mouseleave', function () {
    titleWrap.classList.remove('marquee');
    titleText.style.removeProperty('--scroll-distance');
    titleText.style.removeProperty('--scroll-duration');
  });
}

function makeItem(item, isRead) {
  var button = document.createElement('button');
  button.type = 'button';
  button.className = 'item' + (isRead ? ' read' : ' unread') + (item.headline ? ' headline' : '');
  button.dataset.url = item.url;

  var timeEl = el('span', 'item-time', item.timeText ? fmt.formatCompactTime(item.timeText) : '');
  if (item.timeText) timeEl.title = item.timeText;

  var axis = el('span', 'item-axis');
  axis.setAttribute('aria-hidden', 'true');

  var titleWrap = el('span', 'item-title');
  var titleText = el('span', 'item-title-text', item.title);
  titleWrap.appendChild(titleText);

  var tags = el('span', 'item-tags');
  var tag = typeLabel(item.type);
  if (tag) {
    var tagType = String(item.type || '').replace(/[^a-z]/g, '') || 'external';
    tags.appendChild(el('span', 'item-tag ' + tagType, tag));
  }

  button.appendChild(timeEl);
  button.appendChild(axis);
  button.appendChild(titleWrap);
  button.appendChild(tags);

  attachTitleScroller(button, titleWrap, titleText);
  button.addEventListener('click', function () {
    openArticle(item);
  });
  return button;
}

function renderList() {
  var list = els.list;
  var footer = els.listFooter;
  list.textContent = '';
  footer.textContent = '';

  if (!state.items.length) {
    if (state.refreshing) {
      for (var s = 0; s < 7; s++) list.appendChild(makeSkeleton());
    } else {
      var empty = el('div', 'empty');
      empty.appendChild(el('div', 'empty-title', '还没有内容'));
      empty.appendChild(el('div', 'empty-desc', '点右上角的刷新按钮抓取一次；如果一直失败，看看是不是网络或站点的问题。'));
      list.appendChild(empty);
    }
    return;
  }

  var meta = state.meta || {};
  var lastSeenAt = meta.lastSeenAt || 0;
  var maxPage = 1;
  for (var m = 0; m < state.items.length; m++) {
    var p = state.items[m].page || 0;
    if (p > maxPage) maxPage = p;
  }
  if (state.expandedPages > maxPage) state.expandedPages = maxPage;

  var visible = state.items.filter(function (item) {
    if (item.headline) return true;
    return (item.page || 1) <= state.expandedPages;
  });

  var dividerPlaced = false;
  var seenNew = false;
  var headlineLabelShown = false;
  var listLabelShown = false;

  for (var i = 0; i < visible.length; i++) {
    var item = visible[i];
    var isNew = (item.firstSeenAt || 0) > lastSeenAt;
    if (isNew) seenNew = true;
    if (!dividerPlaced && seenNew && !isNew) {
      list.appendChild(makeDivider('以上为上次查看后的新内容'));
      dividerPlaced = true;
    }
    if (item.headline && !headlineLabelShown) {
      list.appendChild(makeSectionLabel('头条', true));
      headlineLabelShown = true;
    }
    if (!item.headline && !listLabelShown) {
      if (headlineLabelShown) list.appendChild(makeSectionLabel('今日要闻', false));
      listLabelShown = true;
    }
    list.appendChild(makeItem(item, !!state.read[item.url]));
  }

  var remaining = 0;
  for (var r = 0; r < state.items.length; r++) {
    var candidate = state.items[r];
    if (!candidate.headline && (candidate.page || 1) > state.expandedPages) remaining += 1;
  }
  if (remaining > 0) {
    var more = el('button', 'load-more', '加载更多（还有 ' + remaining + ' 条）');
    more.type = 'button';
    more.addEventListener('click', function () {
      var scroll = els.list.scrollTop;
      state.expandedPages += 1;
      renderList();
      els.list.scrollTop = scroll;
    });
    footer.appendChild(more);
  } else {
    footer.appendChild(el('div', 'list-end', '已经到底了 · 共 ' + state.items.length + ' 条'));
  }
}

async function markReadUrl(url) {
  if (!url || state.read[url]) return;
  state.read[url] = Date.now();
  try {
    await store.markRead(url, Date.now());
  } catch (err) { /* 忽略 */ }
}

async function openArticle(item) {
  // 专题/活动页是前端渲染的聚合页，插件内无法阅读：点击标题直接在新标签页打开原站
  if (item.type === 'topic' || item.type === 'external') {
    markReadUrl(item.url);
    renderList();
    openExternal(item.url);
    showToast('已在新标签页打开原文');
    return;
  }
  state.listScroll = els.list.scrollTop;
  state.articleItem = item;
  state.articleUrl = item.url;
  state.article = null;
  state.articleError = '';
  state.articleNotice = null;
  state.articleLoading = true;
  state.view = 'article';
  render();
  await markReadUrl(item.url);
  loadArticle(item);
}

async function loadArticle(item) {
  var readable = item.type === 'article' || item.type === 'community';
  if (!readable) {
    state.articleLoading = false;
    state.articleNotice = {
      title: '该条内容无法在插件内阅读',
      message: item.type === 'topic'
        ? '这是一条专题/活动页面（站点用前端脚本渲染），需要原站打开。'
        : item.type === 'community'
          ? '这是一条游民圈子社区帖，模板与新闻页不同，需要原站打开。'
          : '这是一条站外链接，需要原站打开。',
      url: item.url,
    };
    render();
    return;
  }

  state.articleLoading = true;
  state.articleError = '';
  state.articleNotice = null;
  render();

  try {
    var cached = await store.getCachedArticle(item.url);
    if (cached && typeof cached.totalPages === 'number' && Array.isArray(cached.allPages)) {
      state.article = {
        title: cached.title,
        meta: cached.meta || {},
        blocks: cached.blocks || [],
        allPages: cached.allPages,
        nextIndex: cached.nextIndex || 0,
        totalPages: cached.totalPages,
        loadingMore: false,
        loadMoreError: '',
      };
      state.articleLoading = false;
      render();
      return;
    }
    var html = await fetchArticleHtml(item.url);
    var parsed = parseArticlePage(html, item.url);
    if (parsed.kind === 'redirect') {
      state.articleLoading = false;
      state.articleNotice = {
        title: '该条是专题入口',
        message: '原站会把这个链接跳转到专题聚合页，插件内无法阅读。',
        url: parsed.targetUrl || item.url,
      };
      render();
      return;
    }
    var article = createArticleState(parsed, item);
    state.article = article;
    state.articleLoading = false;
    render();
    if (article.allPages.length) {
      // 首屏连同第一页共展开 5 页；更多分页由「加载更多页」按钮分批加载
      await loadPageBatch(article, Math.min(PAGE_BATCH_SIZE - 1, article.allPages.length));
    } else {
      try {
        await store.cacheArticle(item.url, serializeArticle(article), Date.now());
      } catch (err) { /* 忽略 */ }
    }
  } catch (err) {
    state.articleLoading = false;
    state.articleError = String((err && err.message) || err);
    render();
  }
}

function createArticleState(parsed, item) {
  var pageUrls = parsed.pageUrls || [];
  return {
    title: parsed.title || (item ? item.title : ''),
    meta: parsed.meta || {},
    blocks: (parsed.blocks || []).slice(),
    allPages: pageUrls.slice(),
    nextIndex: 0,
    totalPages: pageUrls.length + 1,
    loadingMore: false,
    loadMoreError: '',
  };
}

function serializeArticle(article) {
  return {
    title: article.title,
    meta: article.meta || {},
    blocks: article.blocks || [],
    allPages: article.allPages || [],
    nextIndex: article.nextIndex || 0,
    totalPages: article.totalPages || 1,
  };
}

async function loadPageBatch(article, count) {
  if (!article || article.loadingMore) return;
  var remaining = article.allPages.length - article.nextIndex;
  if (remaining <= 0) return;
  article.loadingMore = true;
  article.loadMoreError = '';
  renderArticle();
  var goal = Math.min(count, remaining);
  for (var i = 0; i < goal; i++) {
    var page = article.allPages[article.nextIndex];
    try {
      var html = await fetchArticleHtml(page.url);
      var parsed = parseArticlePage(html, page.url);
      if (parsed.kind === 'article') article.blocks = article.blocks.concat(parsed.blocks || []);
      article.nextIndex += 1;
    } catch (err) {
      article.loadMoreError = '第 ' + page.page + ' 页加载失败：' + String((err && err.message) || err);
      break;
    }
  }
  article.loadingMore = false;
  renderArticle();
  if (state.articleItem) {
    try {
      await store.cacheArticle(state.articleItem.url, serializeArticle(article), Date.now());
    } catch (err) { /* 忽略 */ }
  }
}

function renderArticle() {
  var container = els.article;
  container.textContent = '';
  var item = state.articleItem;
  if (!item) return;

  if (state.articleLoading) {
    var loading = el('div', 'article-loading');
    for (var s = 0; s < 5; s++) loading.appendChild(makeSkeleton());
    container.appendChild(loading);
    container.appendChild(el('div', 'article-note', '正在抓取正文…'));
    return;
  }

  if (state.articleNotice) {
    container.appendChild(renderNotice(state.articleNotice));
    return;
  }

  if (state.articleError) {
    var box = el('div', 'notice');
    box.appendChild(el('div', 'notice-title', '正文抓取失败'));
    box.appendChild(el('div', null, state.articleError));
    var actions = el('div', 'notice-actions');
    var retry = el('button', 'notice-btn', '重试');
    retry.type = 'button';
    retry.addEventListener('click', function () { loadArticle(item); });
    actions.appendChild(retry);
    var original = el('a', 'notice-btn', '打开原文 ↗');
    original.href = item.url;
    original.target = '_blank';
    original.rel = 'noreferrer';
    actions.appendChild(original);
    box.appendChild(actions);
    container.appendChild(box);
    return;
  }

  var article = state.article;
  if (!article) return;

  container.appendChild(el('h1', 'article-title', article.title || item.title));
  var meta = article.meta || {};
  var metaLine = el('div', 'article-meta');
  if (meta.timeText) metaLine.appendChild(el('span', null, fmt.formatArticleTime(meta.timeText)));
  if (meta.source) metaLine.appendChild(el('span', null, '来源：' + meta.source));
  if (meta.author) metaLine.appendChild(el('span', null, '作者：' + meta.author));
  if (metaLine.childNodes.length) container.appendChild(metaLine);

  var body = el('div', 'article-body');
  var blocks = article.blocks || [];
  for (var i = 0; i < blocks.length; i++) renderBlock(body, blocks[i]);
  container.appendChild(body);

  if (!blocks.length) {
    container.appendChild(el('div', 'article-note', '正文没能解析出来，点右上角「原文」查看。'));
  }
  if (article.totalPages > 1) {
    var loadedPages = article.nextIndex + 1;
    var remainingPages = article.allPages.length - article.nextIndex;
    if (remainingPages > 0) {
      var moreBtn = el('button', 'load-more-pages', article.loadingMore ? '正在加载分页…' : '加载更多页（还剩 ' + remainingPages + ' 页）');
      moreBtn.type = 'button';
      moreBtn.disabled = !!article.loadingMore;
      moreBtn.addEventListener('click', function () {
        loadPageBatch(article, PAGE_BATCH_SIZE);
      });
      container.appendChild(moreBtn);
      if (article.loadMoreError) {
        container.appendChild(el('div', 'article-note', article.loadMoreError + '，点上面按钮重试。'));
      }
      container.appendChild(el('div', 'article-page-note', '已显示 ' + loadedPages + ' / ' + article.totalPages + ' 页'));
    } else {
      container.appendChild(el('div', 'article-page-note', '已加载全部 ' + article.totalPages + ' 页'));
    }
  }
}

function renderBlock(container, block) {
  if (!block) return;
  if (block.type === 'text') {
    var p = el('p');
    if (block.runs && block.runs.length) {
      for (var i = 0; i < block.runs.length; i++) {
        var run = block.runs[i];
        if (run.href) {
          var link = el('a', null, run.text);
          link.href = run.href;
          link.target = '_blank';
          link.rel = 'noreferrer';
          p.appendChild(link);
        } else {
          p.appendChild(document.createTextNode(run.text));
        }
      }
    } else {
      p.textContent = block.text;
    }
    container.appendChild(p);
    return;
  }
  if (block.type === 'image') {
    var slot = el('div', 'image-slot');
    var placeholder = el('button', 'image-placeholder', (block.animated ? '动图' : '图片') + ' · 点击加载');
    placeholder.type = 'button';
    placeholder.title = block.alt || '点击加载图片';
    placeholder.addEventListener('click', function () {
      var img = document.createElement('img');
      img.className = 'article-image';
      img.alt = block.alt || '';
      img.loading = 'lazy';
      img.src = block.src;
      img.addEventListener('error', function () {
        placeholder.textContent = '图片加载失败';
      });
      if (block.link) {
        var anchor = document.createElement('a');
        anchor.href = block.link;
        anchor.target = '_blank';
        anchor.rel = 'noreferrer';
        anchor.appendChild(img);
        slot.replaceChild(anchor, placeholder);
      } else {
        slot.replaceChild(img, placeholder);
      }
    });
    slot.appendChild(placeholder);
    container.appendChild(slot);
    return;
  }
  if (block.type === 'video') {
    var videoLink = el('a', 'video-link', '▶ ' + (block.platform || '视频') + '（原站观看）');
    videoLink.href = block.url;
    videoLink.target = '_blank';
    videoLink.rel = 'noreferrer';
    container.appendChild(videoLink);
  }
}

function renderNotice(notice) {
  var box = el('div', 'notice');
  box.appendChild(el('div', 'notice-title', notice.title || '提示'));
  box.appendChild(el('div', null, notice.message || ''));
  var actions = el('div', 'notice-actions');
  var link = el('a', 'notice-btn', '打开原文 ↗');
  link.href = notice.url;
  link.target = '_blank';
  link.rel = 'noreferrer';
  actions.appendChild(link);
  box.appendChild(actions);
  return box;
}

function goBack() {
  state.view = 'list';
  state.article = null;
  state.articleItem = null;
  state.articleError = '';
  state.articleNotice = null;
  render();
  if (state.listScroll) els.list.scrollTop = state.listScroll;
}

async function markAllRead() {
  try {
    state.read = await store.markAllRead(state.items, Date.now());
  } catch (err) { /* 忽略 */ }
  closeMenu();
  if (state.view === 'list') renderList();
  showToast('已全部标为已读');
}

function showToast(text) {
  els.toast.textContent = text;
  els.toast.hidden = false;
  if (state.toastTimer) clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(function () {
    els.toast.hidden = true;
  }, 1800);
}

function openExternal(url) {
  if (!url) return;
  try {
    if (chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url: url });
      return;
    }
  } catch (err) { /* 退回到 window.open */ }
  window.open(url, '_blank', 'noopener');
}

init().catch(function (err) {
  var statusline = document.getElementById('statusline');
  if (statusline) statusline.textContent = '初始化失败：' + String((err && err.message) || err);
});
