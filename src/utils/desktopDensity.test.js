import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

test('laptop layouts use a compact native-zoom density profile', () => {
  assert.match(css, /@media \(min-width: 901px\) and \(max-width: 1600px\)/);
  assert.match(css, /--laptop-sidebar-width:\s*212px/);
  assert.match(css, /--laptop-topbar-height:\s*60px/);
  assert.match(css, /--laptop-content-padding:\s*1\.25rem/);
  assert.match(css, /--laptop-control-height:\s*38px/);
});

test('the live-status rail yields content space on laptop viewports', () => {
  assert.match(css, /@media \(max-width: 1600px\)\s*\{[\s\S]*?\.live-status-rail\s*\{[\s\S]*?transform:\s*translateX\(100%\)/);
  assert.match(css, /\.topbar-live-status-toggle\s*\{[\s\S]*?display:\s*inline-flex/);
});

test('desktop density does not rely on CSS page scaling', () => {
  assert.doesNotMatch(css, /(^|[;{]\s*)zoom\s*:/m);
  assert.doesNotMatch(css, /html\s*\{[^}]*font-size:\s*80%/s);
});
