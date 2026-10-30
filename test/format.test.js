import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatListTime,
  formatCompactTime,
  formatArticleTime,
  siteDateString,
  formatClock,
  todayLabel,
} from '../lib/format.js';

const NOW = Date.parse('2026-10-30T09:00:00+08:00');

test('siteDateString 使用站点时区（北京时间）', () => {
  assert.equal(siteDateString(NOW), '2026-10-30');
  assert.equal(siteDateString(Date.parse('2026-10-30T23:30:00+08:00')), '2026-10-30');
});

test('formatListTime：HH:mm 换算成相对时间，MM-DD 原样', () => {
  assert.equal(formatListTime('09:00', NOW), '刚刚');
  assert.equal(formatListTime('08:30', NOW), '30 分钟前');
  assert.equal(formatListTime('07:00', NOW), '2 小时前');
  assert.equal(formatListTime('01:05', NOW), '7 小时前');
  assert.equal(formatListTime('10-29', NOW), '10-29');
  assert.equal(formatListTime('', NOW), '');
});

test('formatCompactTime：s/m/h 与 MM-DD', () => {
  assert.equal(formatCompactTime('09:00', NOW), '1s');
  assert.equal(formatCompactTime('08:59', NOW), '1m');
  assert.equal(formatCompactTime('08:30', NOW), '30m');
  assert.equal(formatCompactTime('07:00', NOW), '2h');
  assert.equal(formatCompactTime('10-29', NOW), '10-29');
  assert.equal(formatCompactTime('', NOW), '');
});

test('formatArticleTime：保留到分钟', () => {
  assert.equal(formatArticleTime('2026-10-30 01:05:12'), '2026-10-30 01:05');
  assert.equal(formatArticleTime(''), '');
});

test('formatClock / todayLabel', () => {
  assert.equal(formatClock(NOW), '09:00');
  assert.match(todayLabel(NOW), /10月30日/);
});
