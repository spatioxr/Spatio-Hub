import assert from 'node:assert/strict';
import test from 'node:test';
import { filterPolicies, getPolicyAcknowledgement, MAX_POLICY_BYTES, policyNeedsAcknowledgement, publishPolicyPdf, validatePolicyPdf } from './policies.js';
import { hasPermission, PERMISSIONS } from './rbac.js';

const pdf = () => new File(['%PDF-1.7\nPDF fixture'], 'Remote policy.pdf', { type: 'application/pdf' });
const attempt = () => ({ file: pdf(), title: ' Remote policy ', description: '', requiresAcknowledgement: true, document: null, versionId: 'version-1' });

test('only active Admin and Superadmin can manage company policies', () => {
  for (const role of ['employee', 'manager', 'admin', 'superadmin']) {
    assert.equal(hasPermission({ role, status: 'Active' }, PERMISSIONS.MANAGE_POLICIES), ['admin', 'superadmin'].includes(role));
    assert.equal(hasPermission({ role, status: 'Released' }, PERMISSIONS.MANAGE_POLICIES), false);
  }
});

test('PDF validation rejects missing, empty, oversized and renamed non-PDF files', async () => {
  await validatePolicyPdf(pdf());
  // Browser file MIME metadata can be absent; inspect the PDF signature too.
  await validatePolicyPdf(new File(['%PDF-1.7'], 'policy.PDF'));
  await assert.rejects(validatePolicyPdf(null), /Choose a PDF/);
  await assert.rejects(validatePolicyPdf(new File([], 'empty.pdf')), /20 MB/);
  await assert.rejects(validatePolicyPdf(new File(['<html>not a PDF'], 'fake.pdf')), /not a valid PDF/);
  await assert.rejects(validatePolicyPdf({ name: 'large.pdf', size: MAX_POLICY_BYTES + 1 }), /20 MB/);
  await assert.rejects(validatePolicyPdf(new File(['%PDF-1.7'], 'policy.html')), /Choose a PDF/);
});

test('an old acknowledgement never clears the current version or an archived policy', () => {
  const document = { current_version_id: 'new', archived_at: null, version: { title: 'Remote', description: 'Work from home', requires_acknowledgement: true } };
  assert.equal(policyNeedsAcknowledgement(document, new Set(['old'])), true);
  assert.equal(policyNeedsAcknowledgement(document, new Set(['new'])), false);
  const archived = { ...document, archived_at: '2026-09-05' };
  const reference = { ...document, version: { ...document.version, requires_acknowledgement: false } };
  assert.equal(policyNeedsAcknowledgement(archived, new Set()), false);
  assert.equal(policyNeedsAcknowledgement(reference, new Set()), false);
  assert.deepEqual(filterPolicies([document, archived, reference], 'HOME', 'pending', new Set()), [document]);
  assert.deepEqual(filterPolicies([document, archived], '', 'archived', new Set()), [archived]);
});

test('a failed upload never publishes a policy or claims success', async () => {
  let publications = 0;
  const client = { storage: { from: () => ({ upload: async () => ({ error: new Error('Upload failed') }) }) }, rpc: async () => { publications += 1; } };
  const request = attempt();
  await assert.rejects(publishPolicyPdf(client, 'admin-id', request), /Upload failed/);
  assert.equal(publications, 0);
  assert.equal(request.uploaded, undefined);
});

test('uncertain publication retries retain the version ID and do not upload again', async () => {
  const uploads = [];
  const calls = [];
  const client = {
    storage: { from: (bucket) => ({ upload: async (...args) => { uploads.push([bucket, ...args]); return {}; } }) },
    rpc: async (name, args) => { calls.push([name, args]); return calls.length === 1 ? { error: new Error('Network lost') } : { data: { id: args.new_version_id } }; },
  };
  const request = attempt();
  request.document = { id: 'document-1', current_version_id: 'old-version' };
  await assert.rejects(publishPolicyPdf(client, 'admin-id', request), /Network lost/);
  assert.deepEqual(await publishPolicyPdf(client, 'admin-id', request), { id: 'version-1' });
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0][1], 'admin-id/version-1.pdf');
  assert.equal(uploads[0][3].upsert, false);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0][1].expected_version_id, 'old-version');
  assert.equal(calls[0][1].policy_title, 'Remote policy');
});

test('duplicate immutable upload response can resume publication but arbitrary upload errors cannot', async () => {
  let publications = 0;
  const client = {
    storage: { from: () => ({ upload: async () => ({ error: { statusCode: '409' } }) }) },
    rpc: async () => { publications += 1; return { data: { id: 'version-1' } }; },
  };
  await publishPolicyPdf(client, 'admin-id', attempt());
  assert.equal(publications, 1);
});

test('acknowledgement handles PostgREST row arrays and rejects missing or wrong-version confirmations', () => {
  const ack = { version_id: 'version-1', employee_id: 'employee-1', acknowledged_at: '2026-09-05T00:00:00Z' };
  assert.deepEqual(getPolicyAcknowledgement(ack, 'version-1'), ack);
  assert.deepEqual(getPolicyAcknowledgement([ack], 'version-1'), ack);
  for (const value of [null, [], {}, { ...ack, acknowledged_at: null }]) {
    assert.throws(() => getPolicyAcknowledgement(value, 'version-1'), /could not be confirmed/);
  }
  assert.throws(() => getPolicyAcknowledgement(ack, 'version-2'), /could not be confirmed/);
});

test('publication handles returned row arrays and does not claim success for an empty response', async () => {
  let result = [];
  const client = { storage: { from: () => ({ upload: async () => ({}) }) }, rpc: async () => ({ data: result }) };
  const request = attempt();
  await assert.rejects(publishPolicyPdf(client, 'admin-id', request), /could not be confirmed/);
  result = [{ id: 'version-1' }];
  assert.deepEqual(await publishPolicyPdf(client, 'admin-id', request), result[0]);
});
