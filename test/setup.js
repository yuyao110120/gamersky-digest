// 测试环境：给 Node 注入 DOMParser（jsdom）
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser;
globalThis.__jsdomWindow = dom.window;
