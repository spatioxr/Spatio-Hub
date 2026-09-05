import React, { lazy, Suspense, useCallback, useContext, useEffect, useRef, useState } from 'react';
import Layout from '../components/Layout';
import AppState from '../components/AppState';
import { AuthContext } from '../context/AuthContext';
import useDialogFocus from '../hooks/useDialogFocus';
import { supabase } from '../utils/supabaseClient';
import { hasPermission, PERMISSIONS } from '../utils/rbac';
import { filterPolicies, getPolicyAcknowledgement, POLICY_BUCKET, policyNeedsAcknowledgement, publishPolicyPdf } from '../utils/policies';
import './Policies.css';

const PolicyPdfViewer = lazy(() => import('../components/PolicyPdfViewer'));

const dateLabel = (value) => new Date(value).toLocaleDateString('en-IN', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
});
const timeLabel = (value) => new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
const errorMessage = (error, fallback) => error?.message || fallback;

function UploadPolicy({ document, employeeId, onClose, onPublished }) {
  const [title, setTitle] = useState(document?.version.title || '');
  const [description, setDescription] = useState(document?.version.description || '');
  const [requiresAcknowledgement, setRequiresAcknowledgement] = useState(
    document?.version.requires_acknowledgement ?? true,
  );
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const attemptRef = useRef(null);
  const busyRef = useRef(false);
  const dialogRef = useDialogFocus(true, onClose, { closeDisabled: saving });

  const save = async (event) => {
    event.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;
    setSaving(true);
    setError('');
    try {
      const previous = attemptRef.current;
      if (!previous || previous.file !== file || previous.title !== title
        || previous.description !== description || previous.requiresAcknowledgement !== requiresAcknowledgement) {
        attemptRef.current = { file, title, description, requiresAcknowledgement, document, versionId: crypto.randomUUID() };
      }
      await publishPolicyPdf(supabase, employeeId, attemptRef.current);
      onPublished(title.trim());
    } catch (cause) {
      setError(errorMessage(cause, 'Unable to publish. Please try again.'));
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="drawer-backdrop" onClick={(event) => !saving && event.target === event.currentTarget && onClose()}>
      <aside className="drawer policy-upload" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="policy-upload-title" tabIndex="-1">
        <div className="people-drawer-header">
          <div><span className="page-eyebrow">Company documents</span><h2 id="policy-upload-title">{document ? 'Replace PDF' : 'Upload a policy'}</h2>
            <p>{document ? 'The new version will replace the current PDF. Previous acknowledgements are kept.' : 'Upload a vetted PDF. It will be available to everyone immediately.'}</p>
          </div>
          <button className="people-icon-button" type="button" disabled={saving} onClick={onClose} aria-label="Close upload"><i className="ri-close-line" aria-hidden="true" /></button>
        </div>
        <form onSubmit={save} className="people-form policy-upload-form">
          {error && <div className="people-feedback people-feedback--error" role="alert">{error}</div>}
          <fieldset disabled={saving}>
            <label className="people-field"><span>Document title</span><input required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Remote Work Policy" /></label>
            <label className="people-field"><span>Description <small>(optional)</small></span><textarea maxLength={2000} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="A short note to help people find the right document" /></label>
            <label className="people-field policy-file-field"><span>PDF document</span><input type="file" accept="application/pdf,.pdf" required onChange={(event) => setFile(event.target.files?.[0] || null)} /><small>PDF only · Up to 20 MB</small></label>
            <label className="policy-checkbox"><input type="checkbox" checked={requiresAcknowledgement} onChange={(event) => setRequiresAcknowledgement(event.target.checked)} /><span><strong>Require acknowledgement</strong><small>Everyone must click “I have read this” for this version. This does not block access to the portal.</small></span></label>
            <div className="people-drawer-actions"><button className="btn btn-outline" type="button" onClick={onClose}>Cancel</button><button className="btn" type="submit">{saving ? 'Uploading and publishing…' : document ? 'Upload & publish new version' : 'Upload & publish'}</button></div>
          </fieldset>
        </form>
      </aside>
    </div>
  );
}

function AcknowledgementReport({ version, isCurrent }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [filter, setFilter] = useState('all');
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    supabase.rpc('policy_acknowledgement_report', { target_version_id: version.id }).then(({ data, error: cause }) => {
      if (cancelled) return;
      if (cause) setError(errorMessage(cause, 'Unable to load acknowledgements.'));
      else setRows(data || []);
      setLoading(false);
    }).catch((cause) => { if (!cancelled) { setError(errorMessage(cause, 'Unable to load acknowledgements.')); setLoading(false); } });
    return () => { cancelled = true; };
  }, [version.id, retry]);
  const pending = rows.filter((row) => !row.acknowledged_at).length;
  const visible = rows.filter((row) => filter === 'all' || (filter === 'pending' ? !row.acknowledged_at : row.acknowledged_at));
  return (
    <section className="policy-report" aria-label="Acknowledgement report">
      <div className="policy-section-heading"><div><h3>Acknowledgements · Version {version.version_number}</h3><p>{isCurrent && version.requires_acknowledgement ? 'Pending includes all currently active staff. Times are shown in IST.' : 'Historical acknowledgements are retained. Pending staff are only listed for a current, required version.'}</p></div>
        <button className="btn btn-outline" type="button" onClick={() => setRetry((value) => value + 1)} disabled={loading}>Refresh report</button>
      </div>
      {loading ? <AppState type="loading" title="Loading acknowledgements…" compact /> : error ? <AppState type="error" title="Report unavailable" message={error} compact /> : <>
        <label className="policy-report-filter"><span>Show</span><select aria-label="Filter acknowledgements" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">Everyone ({rows.length})</option><option value="pending">Pending ({pending})</option><option value="read">Acknowledged ({rows.length - pending})</option></select></label>
        {visible.length === 0 ? <AppState title="No matching acknowledgements" compact /> : <div className="policy-table-scroll"><table className="policy-table"><thead><tr><th scope="col">Person</th><th scope="col">Department</th><th scope="col">Acknowledgement</th></tr></thead><tbody>{visible.map((row) => <tr key={row.employee_id}><td>{row.employee_name}{row.employment_status !== 'Active' && <small>{row.employment_status}</small>}</td><td>{row.department || '—'}</td><td>{row.acknowledged_at ? timeLabel(row.acknowledged_at) : <span className="policy-status policy-status--pending">Pending</span>}</td></tr>)}</tbody></table></div>}
      </>}
    </section>
  );
}

function PolicyReader({ document, canManage, acknowledgement, onAcknowledged, onBack }) {
  const [versions, setVersions] = useState([document.version]);
  const [version, setVersion] = useState(document.version);
  const [historyError, setHistoryError] = useState('');
  const [url, setUrl] = useState('');
  const [readyVersion, setReadyVersion] = useState(null);
  const [error, setError] = useState('');
  const [ackError, setAckError] = useState('');
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const [reportOpen, setReportOpen] = useState(false);
  const busyRef = useRef(false);
  const headingRef = useRef(null);
  const isCurrent = version.id === document.current_version_id && !document.archived_at;

  useEffect(() => { headingRef.current?.focus(); }, []);
  useEffect(() => {
    if (!canManage) return undefined;
    let cancelled = false;
    supabase.from('policy_versions').select('*').eq('document_id', document.id).order('version_number', { ascending: false }).then(({ data, error: cause }) => {
      if (cancelled) return;
      if (cause) setHistoryError(errorMessage(cause, 'Unable to load version history.'));
      else setVersions(data || [document.version]);
    }).catch(() => { if (!cancelled) setHistoryError('Unable to load version history. Reopen this policy to retry.'); });
    return () => { cancelled = true; };
  }, [canManage, document.id]);

  useEffect(() => {
    let cancelled = false;
    let objectUrl;
    setUrl(''); setError(''); setAckError(''); setReadyVersion(null);
    supabase.storage.from(POLICY_BUCKET).download(version.object_path).then(({ data, error: cause }) => {
      if (cancelled) return;
      if (cause) { setError(errorMessage(cause, 'Unable to open this PDF.')); return; }
      objectUrl = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
      setUrl(objectUrl);
    }).catch((cause) => { if (!cancelled) setError(errorMessage(cause, 'Unable to open this PDF.')); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [version.id, reload]);

  const acknowledge = async () => {
    if (busyRef.current || readyVersion !== version.id || !isCurrent) return;
    busyRef.current = true; setSaving(true); setAckError('');
    try {
      const { data, error: cause } = await supabase.rpc('acknowledge_policy', { target_version_id: version.id });
      if (cause) throw cause;
      onAcknowledged(getPolicyAcknowledgement(data, version.id));
    } catch (cause) { setAckError(errorMessage(cause, 'Unable to save your acknowledgement. Please try again.')); }
    finally { busyRef.current = false; setSaving(false); }
  };

  return (
    <section className="policy-reader">
      <button className="btn btn-outline" type="button" disabled={saving} onClick={onBack}><i className="ri-arrow-left-line" aria-hidden="true" /> Back to policies</button>
      <div className="policy-section-heading"><div><h2 ref={headingRef} tabIndex="-1">{version.title}</h2><p>{version.description}</p><small>Version {version.version_number} · Published {dateLabel(version.published_at)}{!isCurrent ? ' · Archived version' : ''}</small></div>
        {canManage && versions.length > 1 && <label className="policy-version-select"><span>Version history</span><select aria-label="Version history" value={version.id} disabled={saving} onChange={(event) => { setVersion(versions.find((item) => item.id === event.target.value)); setReportOpen(false); }}>
          {versions.map((item) => <option value={item.id} key={item.id}>Version {item.version_number}{item.id === document.current_version_id ? ' (latest)' : ''} · {dateLabel(item.published_at)}</option>)}
        </select></label>}
      </div>
      {historyError && <p role="alert">{historyError}</p>}
      {error ? <AppState type="error" title="PDF unavailable" message={error} action={<button className="btn" type="button" onClick={() => setReload((value) => value + 1)}>Retry</button>} /> : !url ? <AppState type="loading" title="Opening PDF…" /> : <>
        <div className="policy-reader-tools"><span>Read the document below.</span><a href={url} target="_blank" rel="noopener noreferrer">Open PDF in a new tab</a><a href={url} download={version.file_name}>Download PDF</a></div>
        <Suspense fallback={<AppState type="loading" title="Starting PDF reader…" />}><PolicyPdfViewer key={url} url={url} title={version.title} onReady={() => setReadyVersion(version.id)} /></Suspense>
      </>}
      {isCurrent && version.requires_acknowledgement && <div className="policy-acknowledge" aria-live="polite">
        {acknowledgement ? <p><i className="ri-checkbox-circle-line" aria-hidden="true" /> You acknowledged version {version.version_number} on {timeLabel(acknowledgement.acknowledged_at)} IST.</p> : <><div><strong>Confirm you have read this policy</strong><p>Your acknowledgement will be recorded for version {version.version_number}.</p></div><button className="btn" type="button" disabled={readyVersion !== version.id || saving} onClick={acknowledge}>{saving ? 'Recording…' : 'I have read this'}</button></>}
      </div>}
      {isCurrent && !version.requires_acknowledgement && <p className="policy-reader-help">No acknowledgement is required for this document.</p>}
      {ackError && <div className="people-feedback people-feedback--error" role="alert">{ackError}</div>}
      {canManage && <><button className="btn btn-outline" type="button" aria-expanded={reportOpen} onClick={() => setReportOpen((value) => !value)}>{reportOpen ? 'Hide acknowledgements' : 'View acknowledgements'}</button>{reportOpen && <AcknowledgementReport key={version.id} version={version} isCurrent={isCurrent} />}</>}
    </section>
  );
}

export default function Policies() {
  const { user } = useContext(AuthContext);
  const canManage = hasPermission(user, PERMISSIONS.MANAGE_POLICIES);
  const [documents, setDocuments] = useState([]);
  const [acknowledgements, setAcknowledgements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('active');
  const [upload, setUpload] = useState(null);
  const [reader, setReader] = useState(null);
  const [archiving, setArchiving] = useState(null);
  const requestRef = useRef(0);
  const archiveBusy = useRef(false);
  const ackIds = new Set(acknowledgements.map((item) => item.version_id));

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true); setError('');
    try {
      const [documentResult, ackResult] = await Promise.all([
        supabase.from('policy_documents').select('*').order('created_at', { ascending: false }),
        supabase.from('policy_acknowledgements').select('*').eq('employee_id', user.id),
      ]);
      if (documentResult.error || ackResult.error) throw documentResult.error || ackResult.error;
      const rows = documentResult.data || [];
      const versionResult = rows.length ? await supabase.from('policy_versions').select('*').in('id', rows.map((item) => item.current_version_id)) : { data: [] };
      if (versionResult.error) throw versionResult.error;
      if (request !== requestRef.current) return;
      const versions = new Map(versionResult.data.map((item) => [item.id, item]));
      setDocuments(rows.filter((item) => versions.has(item.current_version_id)).map((item) => ({ ...item, version: versions.get(item.current_version_id) })));
      setAcknowledgements(ackResult.data || []);
    } catch (cause) { if (request === requestRef.current) setError(errorMessage(cause, 'Unable to load policies.')); }
    finally { if (request === requestRef.current) setLoading(false); }
  }, [user.id]);
  useEffect(() => { void load(); return () => { requestRef.current += 1; }; }, [load]);

  const archive = async (document) => {
    if (archiveBusy.current) return;
    archiveBusy.current = true; setArchiving(document.id); setError(''); setNotice('');
    try {
      const { error: cause } = await supabase.rpc('set_policy_archived', { target_document_id: document.id, expected_version_id: document.current_version_id, archive: !document.archived_at });
      if (cause) throw cause;
      setNotice(`${document.version.title} ${document.archived_at ? 'restored for everyone' : 'archived'}.`);
      await load();
    } catch (cause) { setError(errorMessage(cause, 'Unable to update this policy.')); }
    finally { archiveBusy.current = false; setArchiving(null); }
  };

  const visible = filterPolicies(documents, search, filter, ackIds);
  const pending = documents.filter((item) => policyNeedsAcknowledgement(item, ackIds)).length;
  return (
    <Layout title="Policies" eyebrow="Company hub" description="Company policies and documents, all in one place." actions={canManage && !reader ? <button className="btn" type="button" onClick={() => setUpload({ document: null })}><i className="ri-upload-2-line" aria-hidden="true" /> Upload PDF</button> : undefined}>
      {notice && <div className="people-feedback people-feedback--success" role="status">{notice}</div>}
      {reader ? <PolicyReader key={reader.id} document={reader} canManage={canManage} acknowledgement={acknowledgements.find((item) => item.version_id === reader.current_version_id)} onAcknowledged={(ack) => setAcknowledgements((items) => [...items.filter((item) => item.version_id !== ack.version_id), ack])} onBack={() => { setReader(null); void load(); }} /> : <>
        <div className="policy-toolbar"><label className="policy-search"><i className="ri-search-line" aria-hidden="true" /><input type="search" aria-label="Search policies" placeholder="Search policies and documents" value={search} onChange={(event) => setSearch(event.target.value)} /></label><label className="policy-filter"><span>Show</span><select aria-label="Filter policies" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="active">Published documents</option><option value="pending">Needs your acknowledgement ({pending})</option>{canManage && <option value="archived">Archived documents</option>}</select></label><button className="btn btn-outline" type="button" onClick={load} disabled={loading}>Refresh</button></div>
        {error && <AppState type="error" title="Unable to update the library" message={error} action={<button className="btn" type="button" onClick={load}>Retry</button>} />}
        {loading ? <AppState type="loading" title="Loading policies…" /> : !error && visible.length === 0 ? <AppState title={search ? 'No documents match your search' : filter === 'pending' ? 'You’re all caught up' : filter === 'archived' ? 'No archived documents' : 'No policies published yet'} message={filter === 'pending' ? 'You have no outstanding policy acknowledgements.' : canManage ? 'Upload a PDF to share a policy or company document with everyone.' : 'Published company documents will appear here.'} /> : !error && <div className="policy-grid">{visible.map((document) => <article className="policy-card" key={document.id}>
          <div className="policy-card-top"><span className="policy-document-icon"><i className="ri-file-pdf-2-line" aria-hidden="true" /></span><span className={`policy-status${policyNeedsAcknowledgement(document, ackIds) ? ' policy-status--pending' : ''}`}>{document.archived_at ? 'Archived' : !document.version.requires_acknowledgement ? 'For reference' : ackIds.has(document.current_version_id) ? 'Acknowledged' : 'Please acknowledge'}</span></div>
          <h2>{document.version.title}</h2><p>{document.version.description || 'Company-wide document'}</p><small>Version {document.version.version_number} · {dateLabel(document.version.published_at)} · {document.version.file_size < 1024 * 1024 ? `${Math.max(1, Math.round(document.version.file_size / 1024))} KB` : `${(document.version.file_size / 1024 / 1024).toFixed(1)} MB`}</small>
          <div className="policy-card-actions"><button className="btn" type="button" onClick={() => { setNotice(''); setReader(document); }}>Read PDF <i className="ri-arrow-right-line" aria-hidden="true" /></button>{canManage && <><button className="btn btn-outline" type="button" disabled={Boolean(archiving) || Boolean(document.archived_at)} onClick={() => setUpload({ document })}>Replace PDF</button><button className="policy-text-button" type="button" disabled={Boolean(archiving)} onClick={() => archive(document)}>{archiving === document.id ? 'Saving…' : document.archived_at ? 'Restore' : 'Archive'}</button></>}</div>
        </article>)}</div>}
      </>}
      {upload && <UploadPolicy document={upload.document} employeeId={user.id} onClose={() => setUpload(null)} onPublished={(title) => { setUpload(null); setFilter('active'); setSearch(''); setNotice(`${title} is now published for everyone.`); void load(); }} />}
    </Layout>
  );
}
