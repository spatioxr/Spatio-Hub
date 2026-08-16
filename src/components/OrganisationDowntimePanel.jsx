import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AuthContext } from '../context/AuthContext';
import { supabase } from '../utils/supabaseClient';
import { hasPermission, PERMISSIONS } from '../utils/rbac';
import {
  DOWNTIME_CATEGORIES,
  downtimeCategoryLabel,
  downtimeStatusLabel,
  formatDowntimeDuration,
  sumDowntimeSeconds,
  validateDowntimeRange,
} from '../utils/downtime';
import {
  appDateTimeInputToIso,
  appDayRange,
  formatAppDateTime,
  toAppDateTimeInput,
} from '../utils/timezone';
import useDialogFocus from '../hooks/useDialogFocus';

const DOWNTIME_CHANGED_EVENT = 'organisation-downtime-changed';

const formForNewRange = () => {
  const start = new Date();
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    category: 'maintenance',
    title: '',
    notes: '',
    startedAt: toAppDateTimeInput(start),
    endedAt: toAppDateTimeInput(end),
    changeReason: '',
  };
};

const formForEvent = (event) => ({
  category: event.category,
  title: event.title,
  notes: event.notes || '',
  startedAt: toAppDateTimeInput(event.started_at),
  endedAt: toAppDateTimeInput(event.ended_at),
  changeReason: '',
});

const DowntimeDialog = ({ mode, event, saving, error, onClose, onSubmit }) => {
  const isCancel = mode === 'cancel';
  const isStart = mode === 'start';
  const isEdit = mode === 'edit';
  const [form, setForm] = useState(() => (
    isEdit ? formForEvent(event) : formForNewRange()
  ));
  const dialogRef = useDialogFocus(true, onClose, { closeDisabled: saving });

  const change = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const submit = (submitEvent) => {
    submitEvent.preventDefault();
    onSubmit(form);
  };

  const title = isCancel
    ? `Cancel ${event.title}`
    : isStart
      ? 'Start downtime now'
      : isEdit
        ? 'Correct downtime'
        : 'Add scheduled or past downtime';

  return (
    <div className="drawer-backdrop" onClick={(clickEvent) => clickEvent.target === clickEvent.currentTarget && onClose()}>
      <section
        ref={dialogRef}
        className="downtime-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="downtime-dialog-title"
        tabIndex="-1"
      >
        <div className="downtime-dialog-heading">
          <div>
            <span className="page-eyebrow">Organisation downtime</span>
            <h2 id="downtime-dialog-title">{title}</h2>
          </div>
          <button type="button" className="people-icon-button" onClick={onClose} aria-label="Close downtime dialog">
            <i className="ri-close-line" />
          </button>
        </div>

        {error && <div className="people-feedback people-feedback--error" role="alert">{error}</div>}

        <form className="people-form" onSubmit={submit}>
          {isCancel ? (
            <label className="people-field">
              <span>Cancellation reason *</span>
              <textarea
                value={form.changeReason}
                onChange={(inputEvent) => change('changeReason', inputEvent.target.value)}
                rows="3"
                required
                autoFocus
              />
            </label>
          ) : (
            <>
              <div className="people-form-grid">
                <label className="people-field">
                  <span>Category *</span>
                  <select value={form.category} onChange={(inputEvent) => change('category', inputEvent.target.value)}>
                    {DOWNTIME_CATEGORIES.map((category) => (
                      <option key={category.value} value={category.value}>{category.label}</option>
                    ))}
                  </select>
                </label>
                <label className="people-field">
                  <span>Reason *</span>
                  <input
                    value={form.title}
                    onChange={(inputEvent) => change('title', inputEvent.target.value)}
                    placeholder="Office power cut"
                    required
                    autoFocus
                  />
                </label>
              </div>
              {!isStart && (
                <div className="people-form-grid">
                  <label className="people-field">
                    <span>Start (IST) *</span>
                    <input
                      type="datetime-local"
                      value={form.startedAt}
                      onChange={(inputEvent) => change('startedAt', inputEvent.target.value)}
                      required
                    />
                  </label>
                  <label className="people-field">
                    <span>End (IST) *</span>
                    <input
                      type="datetime-local"
                      value={form.endedAt}
                      min={form.startedAt}
                      onChange={(inputEvent) => change('endedAt', inputEvent.target.value)}
                      required
                    />
                  </label>
                </div>
              )}
              <label className="people-field">
                <span>Notes</span>
                <textarea
                  value={form.notes}
                  onChange={(inputEvent) => change('notes', inputEvent.target.value)}
                  rows="3"
                  placeholder="Optional operational context"
                />
              </label>
              {isEdit && (
                <label className="people-field">
                  <span>Change reason *</span>
                  <textarea
                    value={form.changeReason}
                    onChange={(inputEvent) => change('changeReason', inputEvent.target.value)}
                    rows="2"
                    required
                  />
                </label>
              )}
              {isStart && (
                <div className="downtime-live-note">
                  <i className="ri-timer-flash-line" aria-hidden="true" />
                  The server records the start time when you confirm. It stays active even if this browser closes.
                </div>
              )}
            </>
          )}

          <div className="people-drawer-actions">
            <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving}>Back</button>
            <button type="submit" className={`btn${isCancel ? ' btn-danger' : ''}`} disabled={saving}>
              {saving
                ? 'Saving…'
                : isCancel
                  ? 'Cancel downtime'
                  : isStart
                    ? 'Start now'
                    : isEdit
                      ? 'Save correction'
                      : 'Add downtime'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
};

const DowntimeHistoryDialog = ({ event, history, loading, error, onClose }) => {
  const dialogRef = useDialogFocus(true, onClose);
  return (
    <div className="drawer-backdrop" onClick={(clickEvent) => clickEvent.target === clickEvent.currentTarget && onClose()}>
      <section ref={dialogRef} className="downtime-dialog" role="dialog" aria-modal="true" aria-labelledby="downtime-history-title" tabIndex="-1">
        <div className="downtime-dialog-heading">
          <div>
            <span className="page-eyebrow">Immutable history</span>
            <h2 id="downtime-history-title">{event.title}</h2>
          </div>
          <button type="button" className="people-icon-button" onClick={onClose} aria-label="Close downtime history">
            <i className="ri-close-line" />
          </button>
        </div>
        {loading ? <p>Loading change history…</p> : error ? (
          <div className="people-feedback people-feedback--error" role="alert">{error}</div>
        ) : (
          <ol className="downtime-history-list">
            {history.map((item) => (
              <li key={item.audit_id}>
                <strong>{item.action}</strong>
                <span>{item.change_reason}</span>
                <small>{item.changed_by_name} · {formatAppDateTime(item.changed_at)}</small>
              </li>
            ))}
          </ol>
        )}
        <div className="people-drawer-actions">
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>
      </section>
    </div>
  );
};

const OrganisationDowntimePanel = ({ startDate, endDate }) => {
  const { user } = useContext(AuthContext);
  const canManage = hasPermission(user, PERMISSIONS.MANAGE_ORGANISATION_DOWNTIME);
  const [events, setEvents] = useState([]);
  const [activeEvent, setActiveEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dialog, setDialog] = useState(null);
  const [dialogError, setDialogError] = useState('');
  const [saving, setSaving] = useState(false);
  const [historyViewer, setHistoryViewer] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');

  const range = useMemo(() => appDayRange(startDate, endDate), [endDate, startDate]);
  const totalSeconds = useMemo(() => sumDowntimeSeconds(events), [events]);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError('');
    const [periodResult, activeResult] = await Promise.all([
      supabase.rpc('organisation_downtime_for_period', {
        requested_start_at: range.start,
        requested_end_at: range.end,
      }),
      supabase.rpc('active_organisation_downtime'),
    ]);
    const fetchError = periodResult.error || activeResult.error;
    if (fetchError) {
      setError(fetchError.message || 'Unable to load organisation downtime.');
      setEvents([]);
      setActiveEvent(null);
    } else {
      setEvents(periodResult.data || []);
      setActiveEvent(activeResult.data?.[0] || null);
    }
    setLoading(false);
  }, [range]);

  useEffect(() => { void loadEvents(); }, [loadEvents]);

  const announceChange = () => {
    window.dispatchEvent(new CustomEvent(DOWNTIME_CHANGED_EVENT));
  };

  const saveDialog = async (form) => {
    setDialogError('');
    if (!dialog) return;
    if (dialog.mode !== 'cancel' && !form.title.trim()) {
      setDialogError('A downtime reason is required.');
      return;
    }
    if (dialog.mode === 'cancel' && !form.changeReason.trim()) {
      setDialogError('A cancellation reason is required.');
      return;
    }

    let payload;
    let functionName;
    if (dialog.mode === 'start') {
      functionName = 'start_organisation_downtime';
      payload = {
        downtime_category: form.category,
        downtime_title: form.title.trim(),
        downtime_notes: form.notes.trim() || null,
      };
    } else if (dialog.mode === 'cancel') {
      functionName = 'cancel_organisation_downtime';
      payload = {
        target_downtime_event_id: dialog.event.downtime_event_id,
        change_reason: form.changeReason.trim(),
      };
    } else {
      const startedAt = appDateTimeInputToIso(form.startedAt);
      const endedAt = appDateTimeInputToIso(form.endedAt);
      const rangeValidation = validateDowntimeRange(startedAt, endedAt);
      if (rangeValidation) {
        setDialogError(rangeValidation);
        return;
      }
      functionName = dialog.mode === 'edit'
        ? 'update_organisation_downtime'
        : 'create_organisation_downtime';
      payload = {
        ...(dialog.mode === 'edit'
          ? { target_downtime_event_id: dialog.event.downtime_event_id }
          : {}),
        downtime_category: form.category,
        downtime_title: form.title.trim(),
        downtime_notes: form.notes.trim() || null,
        downtime_started_at: startedAt,
        downtime_ended_at: endedAt,
        ...(dialog.mode === 'edit' ? { change_reason: form.changeReason.trim() } : {}),
      };
    }

    setSaving(true);
    const { error: saveError } = await supabase.rpc(functionName, payload);
    if (saveError) {
      setDialogError(saveError.message || 'Unable to save organisation downtime.');
      setSaving(false);
      return;
    }
    const successText = dialog.mode === 'start'
      ? 'Organisation downtime started.'
      : dialog.mode === 'cancel'
        ? 'Organisation downtime cancelled.'
        : dialog.mode === 'edit'
          ? 'Organisation downtime corrected.'
          : 'Organisation downtime added.';
    setDialog(null);
    setSaving(false);
    setNotice(successText);
    announceChange();
    await loadEvents();
  };

  const endNow = async () => {
    if (!activeEvent || saving) return;
    if (!window.confirm(`End “${activeEvent.title}” now?`)) return;
    setSaving(true);
    setError('');
    const { error: endError } = await supabase.rpc('end_organisation_downtime', {
      target_downtime_event_id: activeEvent.downtime_event_id,
    });
    if (endError) setError(endError.message || 'Unable to end organisation downtime.');
    else {
      setNotice('Organisation downtime ended.');
      announceChange();
      await loadEvents();
    }
    setSaving(false);
  };

  const openHistory = async (event) => {
    setHistoryViewer(event);
    setHistory([]);
    setHistoryError('');
    setHistoryLoading(true);
    const { data, error: fetchError } = await supabase.rpc(
      'organisation_downtime_history',
      { target_downtime_event_id: event.downtime_event_id },
    );
    if (fetchError) setHistoryError(fetchError.message || 'Unable to load downtime history.');
    else setHistory(data || []);
    setHistoryLoading(false);
  };

  return (
    <section className="card downtime-panel" aria-labelledby="downtime-panel-title">
      <div className="downtime-panel-heading">
        <div>
          <span className="page-eyebrow">Company-wide</span>
          <h2 id="downtime-panel-title">Organisation downtime</h2>
          <p>Reported separately from employee worked time and breaks.</p>
        </div>
        <div className="downtime-panel-total">
          <span>Recorded in this period</span>
          <strong>{formatDowntimeDuration(totalSeconds)}</strong>
        </div>
      </div>

      {notice && <div className="people-feedback people-feedback--success" role="status">{notice}</div>}
      {error && <div className="people-feedback people-feedback--error" role="alert">{error}</div>}

      {canManage && (
        <div className="downtime-actions">
          {activeEvent ? (
            activeEvent.ended_at ? (
              <button type="button" className="btn" disabled title="A scheduled downtime range already has an end time">
                <i className="ri-timer-line" /> Scheduled downtime active
              </button>
            ) : (
              <button type="button" className="btn" onClick={endNow} disabled={saving}>
                <i className="ri-stop-circle-line" /> End downtime now
              </button>
            )
          ) : (
            <button type="button" className="btn" onClick={() => setDialog({ mode: 'start' })}>
              <i className="ri-timer-flash-line" /> Start downtime now
            </button>
          )}
          <button type="button" className="btn btn-outline" onClick={() => setDialog({ mode: 'create' })}>
            <i className="ri-calendar-event-line" /> Add scheduled or past downtime
          </button>
        </div>
      )}

      {loading ? <p className="downtime-empty">Loading downtime…</p> : events.length === 0 ? (
        <p className="downtime-empty">No organisation downtime overlaps this period.</p>
      ) : (
        <ol className="downtime-event-list">
          {events.map((event) => (
            <li key={event.downtime_event_id} className={`downtime-event downtime-event--${event.event_status}`}>
              <span className="downtime-event-icon"><i className="ri-building-2-line" /></span>
              <div className="downtime-event-copy">
                <div>
                  <strong>{event.title}</strong>
                  <span className={`badge ${event.event_status === 'active' ? 'danger' : event.event_status === 'scheduled' ? 'warning' : 'success'}`}>
                    {downtimeStatusLabel(event.event_status)}
                  </span>
                </div>
                <span>{downtimeCategoryLabel(event.category)} · {formatAppDateTime(event.started_at)}{event.ended_at ? ` – ${formatAppDateTime(event.ended_at)}` : ''}</span>
                {event.notes && <small>{event.notes}</small>}
              </div>
              <div className="downtime-event-duration">
                <strong>{formatDowntimeDuration(event.recorded_seconds)}</strong>
                {canManage && (
                  <div>
                    {event.ended_at && (
                      <button type="button" onClick={() => setDialog({ mode: 'edit', event })}>Edit</button>
                    )}
                    <button type="button" onClick={() => void openHistory(event)}>History</button>
                    <button type="button" onClick={() => setDialog({ mode: 'cancel', event })}>Cancel</button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      {dialog && (
        <DowntimeDialog
          mode={dialog.mode}
          event={dialog.event}
          saving={saving}
          error={dialogError}
          onClose={() => !saving && setDialog(null)}
          onSubmit={saveDialog}
        />
      )}
      {historyViewer && (
        <DowntimeHistoryDialog
          event={historyViewer}
          history={history}
          loading={historyLoading}
          error={historyError}
          onClose={() => setHistoryViewer(null)}
        />
      )}
    </section>
  );
};

export default OrganisationDowntimePanel;
