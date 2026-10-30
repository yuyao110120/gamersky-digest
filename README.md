# 游民要闻（Gamersky Digest）

Chrome 侧边栏扩展：把游民星空（gamersky.com）首页的「今日要闻」搬进侧边栏，点开就能在插件内读正文，不必进站看广告和杂项。

## 功能

- 解析首页「今日要闻」：**6 条头条 + 3 页 × 24 条列表**（站点是服务端一次渲染，插件用「加载更多」逐页展开，不再发请求）
- 列表显示标题 / 时间（当天显示 x 小时前，更早显示 `MM-DD`）/ 摘要（来自 /news/「今日推荐」流，按 URL 匹配，匹配不到就不显示）
- 头条分组置顶、已读/未读、上次查看后的新条目分隔线
- 文章视图：标题、完整时间、来源、作者、正文；站内链接可点；图片默认占位、点击加载；视频显示外链入口；多页文章自动合并前 5 页
- 专题聚合页 / 社区帖 / JS 重定向壳页：提示 + 打开原文（这些不是文章模板）
- 30 分钟后台刷新 + 图标 badge 显示新增条数；打开侧边栏清零
- 打开先渲染缓存，超过 10 分钟自动静默刷新；离线可读缓存列表和最近 30 篇文章
- 深浅色（跟随系统 / 手动）、正文字号三档；快捷键 Alt+G 打开侧边栏

## 安装（解压加载）

1. 打开 `chrome://extensions`
2. 右上角开启「开发者模式」
3. 点「加载已解压的扩展程序」，选择本目录（含 `manifest.json` 的目录）
4. 点工具栏的「游民要闻」图标（或按 Alt+G）打开侧边栏；首次打开会自动抓取，等 1–2 秒

要求 **Chrome 114+**（侧边栏 API）。不上架商店，纯个人使用。

## 使用

- 刷新：右上角 ⟳；状态栏显示「更新于 HH:mm · N 条」
- 加载更多：列表底部按钮，逐页展开到 72 条列表
- 新内容：面板开着时后台抓到新内容，顶部出现「有 N 条更新 · 点击刷新」，不会打乱正在看的列表
- 读文章：点标题 → 正文视图；左上「‹ 返回」回列表（恢复滚动位置）；右上「原文 ↗」跳原站
- 菜单（⋯）：主题、正文字号、全部标为已读、打开游民星空
- 快捷键：Alt+G（macOS 上是 Option+G），可在 `chrome://extensions/shortcuts` 改

## 数据来源与抓取

- 列表：`https://www.gamersky.com/` 首页「今日要闻」模块（服务端渲染，HTML 里就有全部 3 页数据）
- 摘要富化：`https://db2.gamersky.com/LabelJsonpAjax.aspx`（nodeId=11007，即 /news/「今日推荐」第一页 50 条）
- 文章：直接请求文章页 HTML（/news/ 与 /hardware/ 等 CMS 频道同模板）
- 全部请求由扩展自己发起（host_permissions），**不经过任何第三方服务器，不上传数据，不读 Cookie，不注入站点页面**
- 抓取频率：后台每 30 分钟一次；打开面板时若距上次成功超过 10 分钟再补一次；失败后 60 秒内重试一次
- 未使用：RSS（站点没有可用 RSS）、登录态、执行站点 JS

## 权限说明

| 权限 | 用途 |
| --- | --- |
| `sidePanel` | 侧边栏界面 |
| `alarms` | 30 分钟定时刷新 |
| `storage` | 本地缓存列表 / 已读 / 文章（约几百 KB） |
| `offscreen` | Service Worker 里没有 DOMParser，后台解析放在不可见的 offscreen 文档里 |

`host_permissions`：`https://www.gamersky.com/*`、`https://db2.gamersky.com/*`（请求列表页、文章页、摘要接口）。

## 目录结构

```
manifest.json          MV3 清单
background.js         定时抓取 / offscreen 编排 / badge / 消息
offscreen.html|js     后台 DOMParser 宿主
sidepanel.html|css|js 侧边栏（列表 + 文章两视图）
lib/parser.js         纯函数解析器（首页 / 文章 / JSONP 富化）
lib/fetcher.js        网络请求（超时、JSONP 拼装）
lib/store.js          chrome.storage 读写 + 纯合并/裁剪函数
lib/format.js         时间与文案格式化
icons/                占位图标（tools/make-icons.py 生成）
test/                 node --test 单测 + fixtures
tools/make-icons.py   图标生成脚本（纯标准库）
```

## 开发

- 依赖只为测试：`npm install`（jsdom）
- 跑测试：`npm test`
- 解析器 fixture 在 `test/fixtures/`（首页 / 文章 / 多页 / 重定向壳 / JSONP 各一份）。站点改版后，抓一份新页面替换对应 fixture，跑测试即可定位选择器问题
- 图标：`python3 tools/make-icons.py`（不需要第三方库）

## 已知限制

- 只做游民星空，不做其它站点
- 专题聚合页（`/zt/`，Nuxt SPA）和社区帖（`club.gamersky.com`）无法内嵌阅读，只能打开原文
- 部分条目是 JS 重定向壳页（如跳专题），阅读视图会提示
- 摘要依赖 /news/ 第一页 50 条：最多覆盖 50 条条目，其余只显示标题；接口变动时自动降级为无摘要
- 多页文章最多合并前 5 页，剩余给「打开原文」
- 图片默认不加载（省流量），点击才加载
- 时间按站点北京时间显示；跨时区时以文章页完整时间为准
- 站点改版会让选择器失效：连续失败 2 次黄色提示、5 次红色提示，并保留上次成功数据；此时需要更新 `lib/parser.js` 或 `test/fixtures`

## 排障

- 侧边栏空白/报错：打开 `chrome://extensions` →「游民要闻」→ 点「服务工作进程」看日志；侧边栏内右键「检查」看前端报错
- 后台解析日志：`chrome://extensions` → 游民要闻 → service worker 的 Console；offscreen 文档也会出现在扩展的检查视图里
- 清空数据：移除扩展重新加载，或在扩展页面执行 `chrome.storage.local.clear()`

## 设计决策（为什么这么做）

- **侧边栏而非弹窗**：读全文需要高度，侧边栏常驻且不打断当前网页
- **无构建原生 MV3**：个人工具、依赖少、改完刷新即可
- **后台解析用 offscreen**：MV3 Service Worker 没有 DOM，用 `offscreen` 文档跑 DOMParser
- **解析集中在一个文件**：选择器失效时只改一处，fixture 单测兜底
- **不静默失败**：保留上次数据 + 明确提示，避免「看起来正常其实是空的」

## 版本

0.1.0 — 首个可用版本
