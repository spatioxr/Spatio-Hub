import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
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
}) => {
  const isCreate = !activity;
  const drawerRef = useDialogFocus(true, onClose, { closeDisabled: saving });
  const [form, setForm] = useState(() => (
    activity
      ? {
        name: activity.name || '',
        description: activity.description || '',
      }
      : EMPTY_FORM
  ));

  const handleSubmit = (event) => {
    event.preventDefault();
    onSave(form);
  };

  return (
    <div className="drawer-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
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
              {activity?.has_history
                ? 'The name is locked because this activity has reported work. Its description can still be updated.'
                : 'Keep internal work choices concise and distinct from client projects.'}
            </p>
          </div>
          <button type="button" className="people-icon-button" onClick={onClose} aria-label="Close">
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
          <label className="people-field">
            <span>Activity name *</span>
            <input
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              disabled={Boolean(activity?.has_history)}
              placeholder="Internal activity"
              required
            />
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

          <div className="people-drawer-actions">
            <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn" disabled={saving}>
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
    setSaving(true);
    setDrawerError('');

    const activity = drawer.activity;
    const { error: saveError } = activity
      ? await supabase.rpc('update_activity_definition', {
        target_activity_id: activity.id,
        activity_name: form.name,
        activity_description: form.description,
      })
      : await supabase.rpc('create_activity', {
        activity_name: form.name,
        activity_description: form.description,
      });

    if (saveError) {
      setDrawerError(saveError.message || 'Unable to save this activity.');
      setSaving(false);
      return;
    }

    setDrawer(null);
    setNotice(`${form.name.trim()} was ${activity ? 'updated' : 'created'}.`);
    await fetchActivities();
    setSaving(false);
  };

  const changeArchiveState = async (activity) => {
    setError('');
    const shouldArchive = !activity.archived_at;
    const { error: archiveError } = await supabase.rpc('set_activity_archived', {
      target_activity_id: activity.id,
      should_archive: shouldArchive,
    });

    if (archiveError) {
      setError(archiveError.message || 'Unable to change this activity’s status.');
      return;
    }

    setNotice(`${activity.name} was ${shouldArchive ? 'archived' : 'restored'}.`);
    await fetchActivities();
  };

  return (
    <Layout
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

      <div className="project-stats">
        <div className="people-stat">
          <span className="people-stat-icon"><i className="ri-list-check-3" /></span>
          <div><strong>{activities.length}</strong><span>Total activities</span></div>
        </div>
        <div className="people-stat">
          <span className="people-stat-icon people-stat-icon--active"><i className="ri-play-circle-line" /></span>
          <div><strong>{activeCount}</strong><span>Selectable</span></div>
        </div>
        <div className="people-stat">
          <span className="people-stat-icon project-stat-icon--archived"><i className="ri-archive-line" /></span>
          <div><strong>{archivedCount}</strong><span>Archived</span></div>
        </div>
      </div>

      <section className="card project-card">
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
                onClick={() => setStatus(value)}
              >
                {label}
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
          <div className="activity-list">
            {filteredActivities.map((activity) => (
              <article
                className={`activity-row${activity.archived_at ? ' activity-row--archived' : ''}`}
                key={activity.id}
              >
                <span className="activity-row-icon"><i className="ri-lightbulb-flash-line" /></span>
                <div className="activity-row-copy">
                  <div className="project-title-line">
                    <h3>{activity.name}</h3>
                    <span className={`badge ${activity.archived_at ? 'neutral' : 'success'}`}>
                      {activity.archived_at ? 'Archived' : 'Active'}
                    </span>
                    {activity.has_history && <span className="badge neutral">Used in reports</span>}
                  </div>
                  <p>{activity.description || 'No description provided.'}</p>
                </div>
                <div className="project-row-actions">
                  <button type="button" className="people-action-button" onClick={() => openEdit(activity)}>
                    <i className="ri-edit-line" />
                    Edit
                  </button>
                  <button
                    type="button"
                    className={`people-action-button${activity.archived_at ? '' : ' people-action-button--danger'}`}
                    onClick={() => changeArchiveState(activity)}
                  >
                    <i className={activity.archived_at ? 'ri-refresh-line' : 'ri-archive-line'} />
                    {activity.archived_at ? 'Restore' : 'Archive'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {drawer && (
        <ActivityDrawer
          activity={drawer.activity}
          saving={saving}
          error={drawerError}
          onClose={() => setDrawer(null)}
          onSave={saveActivity}
        />
      )}
    </Layout>
  );
};

export default Activities;
