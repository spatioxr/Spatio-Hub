import useUnsavedSettings from '../hooks/useUnsavedSettings';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import WorkSetupLayout from '../components/WorkSetupLayout';
import SortableTable from '../components/SortableTable';
import AppState from '../components/AppState';
import { supabase } from '../utils/supabaseClient';
import useDialogFocus from '../hooks/useDialogFocus';

const EMPTY_FORM = {
  name: '',
  description: '',
};

const ActivityDrawer = ({
  activity,
  saving,
  error,
  onClose,
  onSave,
  onArchive,
}) => {
  const isCreate = !activity;
  const [form, setForm] = useState(() => (
    activity
      ? {
        name: activity.name || '',
        description: activity.description || '',
      }
      : EMPTY_FORM
  ));

  const dirty = form.name !== (activity?.name || '') || form.description !== (activity?.description || '');
  useUnsavedSettings(dirty, saving);
  const requestClose = () => { if (!saving && (!dirty || window.confirm('Discard unsaved activity changes?'))) onClose(); };
  const drawerRef = useDialogFocus(true, requestClose, { closeDisabled: saving });

  const handleSubmit = (event) => {
    event.preventDefault();
    onSave(form);
  };

  return (
    <div className="drawer-backdrop" onClick={(event) => event.target === event.currentTarget && requestClose()}>
      <aside
        ref={drawerRef}
        className="drawer activity-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="activity-drawer-title"
        tabIndex="-1"
      >
        <div className="people-drawer-header">
          <div>
            <span className="page-eyebrow">Activity administration</span>
            <h2 id="activity-drawer-title">{isCreate ? 'Create activity' : activity.name}</h2>
            <p>
              Define when employees should choose this activity.
            </p>
          </div>
          <button type="button" className="people-icon-button" onClick={requestClose} disabled={saving} aria-label="Close">
            <i className="ri-close-line" />
          </button>
        </div>

        {error && (
          <div className="people-feedback people-feedback--error" role="alert">
            <i className="ri-error-warning-line" />
            {error}
          </div>
        )}

        <form className="people-form activity-form" onSubmit={handleSubmit}>
          <fieldset className="work-setup-edit-fields" disabled={saving}>
          <label className="people-field">
            <span>Activity name *</span>
            <input
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              disabled={Boolean(activity?.has_history)}
              placeholder="Internal activity"
              required
            />
            {activity?.has_history && <small>This name is locked because it is used in reports. You can still edit the description.</small>}
          </label>

          <label className="people-field">
            <span>Description</span>
            <textarea
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="When should employees use this activity?"
              rows="4"
            />
          </label>

          {activity && <section className="work-setup-account-actions"><h3>Activity availability</h3><p>{dirty ? 'Save or discard your edits before changing availability.' : activity.archived_at ? 'Restore to make this activity selectable again.' : 'Archiving removes this activity from new work choices. Existing reports are retained.'}</p><button type="button" className="btn btn-outline" disabled={saving || dirty} onClick={() => onArchive(activity)}>{activity.archived_at ? 'Restore activity' : 'Archive activity'}</button></section>}
          </fieldset>
          <div className="people-drawer-actions">
            <button type="button" className="btn btn-outline" onClick={requestClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn" disabled={saving || !dirty}>
              {saving ? 'Saving…' : isCreate ? 'Create activity' : 'Save changes'}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
};

const Activities = () => {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [drawer, setDrawer] = useState(null);
  const [drawerError, setDrawerError] = useState('');
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('active');

  const fetchActivities = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data, error: fetchError } = await supabase.rpc(
      'activity_administration_overview',
    );

    if (fetchError) {
      setActivities([]);
      setError(fetchError.message || 'Unable to load activities.');
    } else {
      setActivities(data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchActivities();
  }, [fetchActivities]);

  useEffect(() => {
    if (!notice) return undefined;
    const timeoutId = window.setTimeout(() => setNotice(''), 5000);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  const filteredActivities = useMemo(() => {
    const query = search.trim().toLowerCase();
    return activities.filter((activity) => {
      const matchesStatus = status === 'all'
        || (status === 'archived' ? activity.archived_at : !activity.archived_at);
      const matchesSearch = !query
        || activity.name.toLowerCase().includes(query)
        || activity.description?.toLowerCase().includes(query);
      return matchesStatus && matchesSearch;
    });
  }, [activities, search, status]);

  const activeCount = activities.filter((activity) => !activity.archived_at).length;
  const archivedCount = activities.length - activeCount;

  const openCreate = () => {
    setDrawerError('');
    setDrawer({ activity: null });
  };

  const openEdit = (activity) => {
    setDrawerError('');
    setDrawer({ activity });
  };

  const saveActivity = async (form) => {
    if (saving) return;
    setSaving(true); setDrawerError('');
    try {
      const activity = drawer.activity;
      const { error: saveError } = activity
        ? await supabase.rpc('update_activity_definition', { target_activity_id: activity.id, activity_name: form.name, activity_description: form.description })
        : await supabase.rpc('create_activity', { activity_name: form.name, activity_description: form.description });
      if (saveError) throw saveError;
      setDrawer(null);
      setNotice(`${form.name.trim()} was ${activity ? 'updated' : 'created'}.`);
      await fetchActivities();
    } catch (failure) { setDrawerError(failure.message || 'Unable to save this activity.'); }
    finally { setSaving(false); }
  };

  const changeArchiveState = async (activity) => {
    if (saving) return;
    setSaving(true); setDrawerError('');
    try {
      const shouldArchive = !activity.archived_at;
      const { error: archiveError } = await supabase.rpc('set_activity_archived', { target_activity_id: activity.id, should_archive: shouldArchive });
      if (archiveError) throw archiveError;
      setDrawer(null);
      setNotice(`${activity.name} was ${shouldArchive ? 'archived' : 'restored'}.`);
      await fetchActivities();
    } catch (failure) { setDrawerError(failure.message || 'Unable to change activity availability.'); }
    finally { setSaving(false); }
  };

  return (
    <WorkSetupLayout
      title="Activities"
      eyebrow="Work Setup"
      heading="Internal activities"
      description="Manage the approved catalogue for non-project work while preserving historical reporting."
      actions={(
        <button type="button" className="btn" onClick={openCreate}>
          <i className="ri-add-line" />
          New activity
        </button>
      )}
    >
      {notice && (
        <div className="people-feedback people-feedback--success" role="status">
          <i className="ri-checkbox-circle-line" />
          {notice}
        </div>
      )}

      <section className="card project-card work-setup-list">
        <div className="filter-bar people-filters">
          <label className="people-search">
            <i className="ri-search-line" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search activities"
              aria-label="Search activities"
            />
          </label>
          <div className="app-tabs" aria-label="Activity status">
            {[
              ['active', 'Active'],
              ['archived', 'Archived'],
              ['all', 'All'],
            ].map(([value, label]) => (
              <button
                type="button"
                key={value}
                className={`app-tab${status === value ? ' active' : ''}`}
                aria-pressed={status === value}
                onClick={() => setStatus(value)}
              >
                {label} ({loading ? '…' : value === 'active' ? activeCount : value === 'archived' ? archivedCount : activities.length})
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <AppState type="loading" title="Loading activities" message="Fetching the approved internal activity catalogue." />
        ) : error ? (
          <AppState
            type="error"
            title="Unable to load activities"
            message={error}
            action={<button type="button" className="btn btn-outline" onClick={fetchActivities}>Try again</button>}
          />
        ) : filteredActivities.length === 0 ? (
          <AppState
            type="empty"
            title={activities.length ? 'No activities match this view' : 'No activities yet'}
            message={activities.length
              ? 'Try another search or activity status.'
              : 'Create the first approved internal activity.'}
          />
        ) : (
          <div className="table-wrap"><SortableTable sortId="setupActivities" className="work-setup-table">
            <thead><tr><th>Activity</th><th>Description</th><th>Status</th><th aria-label="Actions" /></tr></thead>
            <tbody>{filteredActivities.map((activity) => <tr key={activity.id}>
              <td data-label="Activity"><strong>{activity.name}</strong></td>
              <td data-label="Description"><span className="work-setup-description" title={activity.description || ''}>{activity.description || '—'}</span></td>
              <td data-label="Status"><span className={`badge ${activity.archived_at ? 'neutral' : 'success'}`}>{activity.archived_at ? 'Archived' : 'Active'}</span></td>
              <td><button type="button" className="people-action-button" onClick={() => openEdit(activity)}>Edit</button></td>
            </tr>)}</tbody>
          </SortableTable></div>
        )}
      </section>

      {drawer && (
        <ActivityDrawer
          activity={drawer.activity}
          saving={saving}
          error={drawerError}
          onClose={() => setDrawer(null)}
          onSave={saveActivity}
          onArchive={changeArchiveState}
        />
      )}
    </WorkSetupLayout>
  );
};

export default Activities;
