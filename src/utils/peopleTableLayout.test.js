import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const styles = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

test('People desktop rows preserve table-cell layout for continuous separators', () => {
  assert.doesNotMatch(styles, /\.people-table td:nth-child\(2\)\s*\{[^}]*display:\s*flex/);
  assert.doesNotMatch(styles, /\.people-row-actions\s*\{[^}]*display:\s*flex/);
  assert.match(styles, /\.people-row-actions\s*\{[^}]*text-align:\s*right/);
});
