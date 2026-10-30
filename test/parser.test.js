import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseHomePage,
  parseArticlePage,
  canonicalizeUrl,
  classifyUrl,
  ParserError,
} from '../lib/parser.js';

const here = path.dirname(fileURLToPath(import.meta.url));
function fixture(name) {
  return fs.readFileSync(path.join(here, 'fixtures', name), 'utf8');
}

test('parseHomePage：77 条（6 头条 + 71 列表）、3 页、去重、URL 规范化', () => {
  const home = parseHomePage(fixture('home.html'));
  assert.equal(home.items.length, 77);
  assert.deepEqual(home.meta, { featuredCount: 6, listPages: 3, total: 77 });

  const headlines = home.items.filter((item) => item.headline);
  assert.equal(headlines.length, 6);
  assert.equal(home.items.filter((item) => item.page === 0).length, 6);
  assert.equal(home.items.filter((item) => item.page === 1).length, 24);
  assert.equal(home.items.filter((item) => item.page === 2).length, 24);
  assert.equal(home.items.filter((item) => item.page === 3).length, 23);

  const urls = home.items.map((item) => item.url);
  assert.equal(new Set(urls).size, urls.length);
  assert.equal(urls.filter((url) => url.includes('?')).length, 0);
  assert.ok(urls.every((url) => /^https:\/\//.test(url)));

  assert.equal(home.items[0].url, 'https://www.gamersky.com/news/202610/2236740.shtml');
  assert.match(home.items[0].title, /影之刃零/);

  const times = home.items.map((item) => item.timeText);
  assert.ok(times.includes('01:05'));
  assert.ok(times.includes('10-29'));

  const byType = {};
  home.items.forEach((item) => { byType[item.type] = (byType[item.type] || 0) + 1; });
  assert.deepEqual(byType, { article: 72, topic: 1, community: 4 });

  const topic = home.items.find((item) => item.type === 'topic');
  assert.match(topic.url, /\/zt\/assemble\/hottopic/);
  const communities = home.items.filter((item) => item.type === 'community');
  assert.ok(communities.every((item) => item.url.startsWith('https://club.gamersky.com/')));

  // 列表不再带摘要，保持清爽
  assert.ok(home.items.every((item) => !item.summary), '首页条目不应带 summary 字段');
});

test('parseArticlePage：标题 / 元信息 / 正文 / 图片 / 视频', () => {
  const art = parseArticlePage(
    fixture('article-basic.html'),
    'https://www.gamersky.com/news/202610/2237593.shtml'
  );
  assert.equal(art.kind, 'article');
  assert.match(art.title, /刺客信条/);
  assert.deepEqual(art.meta, {
    timeText: '2026-10-30 01:05:12',
    source: '游民星空',
    author: '猛鲨男鱼王',
    editor: '猛鲨男鱼王',
  });

  const textBlocks = art.blocks.filter((block) => block.type === 'text');
  assert.ok(textBlocks.length >= 5);
  assert.ok(textBlocks.every((block) => block.text.length > 0));

  const video = art.blocks.find((block) => block.type === 'video');
  assert.ok(video);
  assert.equal(video.platform, 'B站');
  assert.match(video.url, /bilibili\.com/);

  const image = art.blocks.find((block) => block.type === 'image');
  assert.ok(image);
  assert.match(image.src, /^https:\/\//);

  assert.equal(art.pageUrls.length, 0);
});

test('parseArticlePage：正文里的站内链接保留为可点 runs', () => {
  const art = parseArticlePage(
    fixture('article-links.html'),
    'https://www.gamersky.com/news/202610/2236740.shtml'
  );
  const blocksWithLinks = art.blocks.filter(
    (block) => block.type === 'text' && block.runs.some((run) => run.href)
  );
  assert.ok(blocksWithLinks.length >= 2);
  const anyRun = blocksWithLinks
    .flatMap((block) => block.runs)
    .find((run) => run.href);
  assert.match(anyRun.href, /^https:\/\/www\.gamersky\.com\//);
});

test('parseArticlePage：多页文章返回后续页 URL', () => {
  const art = parseArticlePage(
    fixture('article-multipage.html'),
    'https://www.gamersky.com/news/202610/2237516.shtml'
  );
  assert.equal(art.pageUrls.length, 10);
  assert.equal(art.pageUrls[0].page, 2);
  assert.match(art.pageUrls[0].url, /2237516_2\.shtml$/);
  assert.equal(art.pageUrls[9].page, 11);
});

test('parseArticlePage：懒加载动图解析出真实 gif 地址（不是 blank.png 占位）', () => {
  const art = parseArticlePage(
    fixture('article-gif.html'),
    'https://www.gamersky.com/news/202610/2237541.shtml'
  );
  const images = art.blocks.filter((block) => block.type === 'image');
  assert.ok(images.length >= 3);

  const gifs = images.filter((block) => /\.gif(\?|$)/i.test(block.src));
  assert.ok(gifs.length >= 2, '至少应有 2 张动图，实际 ' + gifs.length);
  assert.ok(gifs.every((block) => block.animated === true));
  // 必须取 data-origin（真正会动的原图），不能取 data-src 的静态预览帧
  assert.ok(
    gifs.some((block) => /\/origin_/.test(block.src)),
    '动图应优先使用 data-origin，实际：' + gifs.map((block) => block.src).join(', ')
  );

  // 占位图不能混进正文，且同一张图不能重复
  assert.equal(images.filter((block) => /blank\.(png|gif)|loading\.(gif|png)/i.test(block.src)).length, 0);
  const srcs = images.map((block) => block.src);
  assert.equal(new Set(srcs).size, srcs.length);
});

test('parseArticlePage：直接外链的 gif 也能识别为动图', () => {
  const art = parseArticlePage(
    fixture('article-gif-direct.html'),
    'https://www.gamersky.com/news/202610/2236949.shtml'
  );
  const gifs = art.blocks.filter((block) => block.type === 'image' && /\.gif(\?|$)/i.test(block.src));
  assert.ok(gifs.length >= 2);
  assert.ok(gifs.every((block) => block.animated === true));
});

test('parseArticlePage：hardware 频道同模板，editor 不带 loading 尾巴', () => {
  const art = parseArticlePage(
    fixture('article-hardware.html'),
    'https://www.gamersky.com/hardware/202610/2237241.shtml'
  );
  assert.match(art.title, /双十一预热硬件/);
  assert.equal(art.meta.editor, '柠萌皝');
  assert.ok(art.blocks.length >= 2);
});

test('parseArticlePage：JS 重定向壳页被识别为 redirect', () => {
  const art = parseArticlePage(
    fixture('redirect-shell.html'),
    'https://www.gamersky.com/news/202610/2237544.shtml'
  );
  assert.equal(art.kind, 'redirect');
  assert.match(art.targetUrl, /\/zt\/assemble\/hottopic/);
});

test('解析失败会抛出带 code 的 ParserError', () => {
  assert.throws(
    () => parseHomePage('<html><body><p>hello</p></body></html>'),
    (err) => err instanceof ParserError && err.code === 'home-module-not-found'
  );
  assert.throws(
    () => parseArticlePage('<html><body><p>hello</p></body></html>', 'https://www.gamersky.com/news/202610/1.shtml'),
    (err) => err instanceof ParserError && err.code === 'article-structure-not-found'
  );
});

test('canonicalizeUrl / classifyUrl', () => {
  assert.equal(
    canonicalizeUrl('/news/202610/2237593.shtml?toutiao#x'),
    'https://www.gamersky.com/news/202610/2237593.shtml'
  );
  assert.equal(canonicalizeUrl('javascript:;'), null);
  assert.equal(canonicalizeUrl('https://gamersky.com/'), 'https://www.gamersky.com/');
  assert.equal(classifyUrl('https://www.gamersky.com/news/202610/2237593.shtml'), 'article');
  assert.equal(classifyUrl('https://www.gamersky.com/hardware/202610/2237241.shtml'), 'article');
  assert.equal(classifyUrl('https://www.gamersky.com/zt/assemble/hottopic/?topicId=626'), 'topic');
  assert.equal(classifyUrl('https://club.gamersky.com/activity/1608504?club=163'), 'community');
  assert.equal(classifyUrl('https://weibo.com/x'), 'external');
});
