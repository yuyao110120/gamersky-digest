// lib/format.js — 时间与文案格式化（纯函数，可在 Node 中测试）
export const SITE_TIME_ZONE = 'Asia/Shanghai';

function pad2(value) {
  var s = String(value);
  return s.length < 2 ? '0' + s : s;
}

export function siteDateString(nowMs) {
  var date = new Date(nowMs == null ? Date.now() : nowMs);
  var parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SITE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  var values = {};
  for (var i = 0; i < parts.length; i++) {
    values[parts[i].type] = parts[i].value;
  }
  return values.year + '-' + values.month + '-' + values.day;
}

export function formatListTime(timeText, nowMs) {
  var text = String(timeText == null ? '' : timeText).trim();
  var now = nowMs == null ? Date.now() : nowMs;
  var hm = text.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) {
    var dateStr = siteDateString(now);
    var ts = Date.parse(dateStr + 'T' + pad2(hm[1]) + ':' + hm[2] + ':00+08:00');
    if (!isNaN(ts)) {
      var diff = now - ts;
      if (diff >= 0 && diff < 60 * 1000) return '刚刚';
      if (diff >= 0 && diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + ' 分钟前';
      if (diff >= 0 && diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + ' 小时前';
    }
    return text;
  }
  if (/^\d{2}-\d{2}$/.test(text)) return text;
  return text;
}

export function formatCompactTime(timeText, nowMs) {
  var text = String(timeText == null ? '' : timeText).trim();
  var now = nowMs == null ? Date.now() : nowMs;
  var hm = text.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) {
    var dateStr = siteDateString(now);
    var ts = Date.parse(dateStr + 'T' + pad2(hm[1]) + ':' + hm[2] + ':00+08:00');
    if (!isNaN(ts)) {
      var diff = now - ts;
      if (diff >= 0 && diff < 60 * 1000) return Math.max(1, Math.floor(diff / 1000)) + 's';
      if (diff >= 0 && diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + 'm';
      if (diff >= 0 && diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + 'h';
    }
    return text;
  }
  if (/^\d{2}-\d{2}$/.test(text)) return text;
  return text;
}

export function formatArticleTime(timeText) {
  var text = String(timeText == null ? '' : timeText).trim();
  var m = text.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/);
  if (m) return m[1] + ' ' + m[2];
  return text;
}

export function formatClock(ts) {
  if (!ts) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: SITE_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(ts));
}

export function formatUpdatedAt(ts) {
  if (!ts) return '尚未更新';
  return '更新于 ' + formatClock(ts);
}

export function todayLabel(nowMs) {
  var date = new Date(nowMs == null ? Date.now() : nowMs);
  var datePart = new Intl.DateTimeFormat('zh-CN', {
    timeZone: SITE_TIME_ZONE,
    month: 'long',
    day: 'numeric',
  }).format(date);
  var weekday = new Intl.DateTimeFormat('zh-CN', {
    timeZone: SITE_TIME_ZONE,
    weekday: 'short',
  }).format(date);
  return datePart + ' ' + weekday;
}
