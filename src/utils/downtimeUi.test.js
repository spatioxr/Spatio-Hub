import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('downtime UI supports live, scheduled and audited controlled actions', async () => {
  const panel = await read('../components/OrganisationDowntimePanel.jsx');

  assert.match(panel, /Start downtime now/);
  assert.match(panel, /End downtime now/);
  assert.match(panel, /Add scheduled or past downtime/);
  assert.match(panel, /start_organisation_downtime/);
  assert.match(panel, /end_organisation_downtime/);
  assert.match(panel, /organisation_downtime_history/);
  assert.doesNotMatch(panel, /\.from\(['"]work_entries['"]\).*\.(insert|update|delete)/s);
});

test('active downtime is announced globally and layouts include mobile safeguards', async () => {
  const [layout, banner, trackWork, timesheets, styles] = await Promise.all([
    read('../components/Layout.jsx'),
    read('../components/OrganisationDowntimeBanner.jsx'),
    read('../pages/TrackWork.jsx'),
    read('../pages/Timesheets.jsx'),
    read('../index.css'),
  ]);

  assert.match(layout, /<OrganisationDowntimeBanner \/>/);
  assert.match(banner, /active_organisation_downtime/);
  assert.match(banner, /role="status"/);
  assert.match(banner, /to="\/track-work"/);
  assert.match(trackWork, /<OrganisationDowntimePanel/);
  assert.match(trackWork, /periodLabel="Recorded this month"/);
  assert.doesNotMatch(timesheets, /<OrganisationDowntimePanel/);
  assert.match(styles, /@media \(max-width: 700px\)[\s\S]*\.downtime-event/);
  assert.match(styles, /\.downtime-dialog[\s\S]*max-height:/);
});
