import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('the application shell exposes keyboard navigation landmarks', () => {
  const layout = read('../components/Layout.jsx');
  const sidebar = read('../components/Sidebar.jsx');
  const topBar = read('../components/TopBar.jsx');
  const timer = read('../components/WorkTimerControl.jsx');

  assert.match(layout, /href="#main-content"/);
  assert.match(layout, /id="main-content"/);
  assert.match(sidebar, /aria-label="Primary navigation"/);
  assert.match(topBar, /aria-haspopup="menu"/);
  assert.match(topBar, /role="menuitem"/);
  assert.match(timer, /aria-label="End work day"/);
  assert.match(timer, /'Start work'/);
});

test('core dialogs share focus trapping, Escape handling, and focus restoration', () => {
  const focusHook = read('../hooks/useDialogFocus.js');
  const coreSurfaces = [
    read('../components/WorkStartModal.jsx'),
    read('../components/WorkEndDayModal.jsx'),
    read('../pages/People.jsx'),
    read('../pages/Projects.jsx'),
    read('../pages/Activities.jsx'),
    read('../pages/Timesheets.jsx'),
    read('../pages/Leave.jsx'),
  ].join('\n');

  assert.match(focusHook, /event\.key !== 'Tab'/);
  assert.match(focusHook, /event\.key === 'Escape'/);
  assert.match(focusHook, /previouslyFocused\.focus\(\)/);
  assert.match(coreSurfaces, /role="dialog"/);
  assert.match(coreSurfaces, /aria-modal="true"/);
  assert.match(coreSurfaces, /useDialogFocus/);
});

test('mobile foundations keep navigation and long tab sets safely scrollable', () => {
  const css = read('../index.css');

  assert.match(css, /\.sidebar-menu\s*\{[\s\S]*overflow-x:\s*auto/);
  assert.match(css, /\.leave-tabs\s*\{[\s\S]*overflow-x:\s*auto/);
  assert.match(css, /\.table-wrap\s*\{[\s\S]*overflow-x:\s*auto/);
  assert.match(css, /max-height:\s*calc\(100dvh/);
});
