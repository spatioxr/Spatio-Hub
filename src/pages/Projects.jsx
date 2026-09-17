import useUnsavedSettings from '../hooks/useUnsavedSettings';
import SortableTable from '../components/SortableTable';
import WorkSetupLayout from '../components/WorkSetupLayout';
import useListSort from '../hooks/useListSort';
import ListSortControls from '../components/ListSortControls';
import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { Link } from 'react-router-dom';
import AppState from '../components/AppState';
import { AuthContext } from '../context/AuthContext';
import { supabase } from '../utils/supabaseClient';
import { hasPermission, PERMISSIONS } from '../utils/rbac';
import useDialogFocus from '../hooks/useDialogFocus';

const EMPTY_FORM = {
  code: '',
  name: '',
  description: '',
  managerIds: [],
  memberIds: [],
};

const initials = (name = '') => (
  name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()
);

const normaliseAssignments = (assignments) => (
  Array.isArray(assignments) ? assignments : []
);

const ProjectDrawer = ({
  project,
  candidates,
  canManageDefinitions,
  loadingCandidates,
  saving,
  error,
  onClose,
  onSave,
  onArchive,
}) => {
  const isCreate = !project;
  const canEditDefinition = canManageDefinitions;
  const [form, setForm] = useState(() => (
    project
      ? {
        code: project.code || '',
        name: project.name || '',
        description: project.description || '',
        managerIds: normaliseAssignments(project.managers).map((manager) => manager.id),
        memberIds: normaliseAssignments(project.members).map((member) => member.id),
      }
      : EMPTY_FORM
  ));

  const initialForm = project ? { code: project.code || '', name: project.name || '', description: project.description || '', managerIds: normaliseAssignments(project.managers).map((person) => person.id), memberIds: normaliseAssignments(project.members).map((person) => person.id) } : EMPTY_FORM;
  const dirty = JSON.stringify(form) !== JSON.stringify(initialForm);
  useUnsavedSettings(dirty, saving);
  const requestClose = () => {
    if (!saving && (!dirty || window.confirm('Discard unsaved project changes?'))) onClose();
  };
  const drawerRef = useDialogFocus(true, requestClose, { closeDisabled: saving });

  const managerCandidates = candidates.filter((candidate) => (
    ['manager', 'admin', 'superadmin'].includes(candidate.role)
  ));

  const toggleAssignment = (field, employeeId) => {
    setForm((current) => ({
      ...current,
      [field]: current[field].includes(employeeId)
        ? current[field].filter((id) => id !== employeeId)
        : [...current[field], employeeId],
    }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    onSave(form);
  };

  return (
    <div className="drawer-backdrop" onClick={(event) => event.target === event.currentTarget && requestClose()}>
      <aside
        ref={drawerRef}
        className="drawer project-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-drawer-title"
        tabIndex="-1"
      >
        <div className="people-drawer-header">
          <div>
            <span className="page-eyebrow">{isCreate ? 'Project setup' : 'Project administration'}</span>
            <h2 id="project-drawer-title">{isCreate ? 'Create project' : project.name}</h2>
            <p>
              {canEditDefinition
                ? 'Edit project details and accountable managers. Team assignments are managed in Projects.'
                : 'Project details are read-only. You can manage this owned project’s team.'}
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

        <form className="people-form project-form" onSubmit={handleSubmit}>
          <fieldset className="work-setup-edit-fields" disabled={saving}>
          <div className="people-form-grid">
            <label className="people-field">
              <span>Project code *</span>
              <input
                value={form.code}
                onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))}
                disabled={!canEditDefinition}
                placeholder="PROJECT"
                required
              />
            </label>
            <label className="people-field">
              <span>Project name *</span>
              <input
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                disabled={!canEditDefinition}
                placeholder="Project name"
                required
              />
            </label>
          </div>

          <label className="people-field">
            <span>Description</span>
            <textarea
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              disabled={!canEditDefinition}
              placeholder="A concise internal description"
              rows="3"
            />
          </label>

          {canEditDefinition && (
            <fieldset className="project-assignment-section">
              <legend>Project managers *</legend>
              <p>Every active project must retain at least one active manager.</p>
              {loadingCandidates ? (
                <span className="project-assignment-loading">Loading eligible managers…</span>
              ) : (
                <div className="project-candidate-list">
                  {managerCandidates.map((candidate) => (
                    <label className="project-candidate" key={candidate.id}>
                      <input
                        type="checkbox"
                        checked={form.managerIds.includes(candidate.id)}
                        onChange={() => toggleAssignment('managerIds', candidate.id)}
                      />
                      <span className="people-avatar">{initials(candidate.name)}</span>
                      <span>
                        <strong>{candidate.name}</strong>
                        <small>{candidate.emp_code} · {candidate.role}</small>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
          )}

          {!isCreate && !canEditDefinition && (
            <fieldset className="project-assignment-section" disabled={Boolean(project.archived_at)}>
              <legend>Team assignees</legend>
              <p>
                {project.archived_at
                  ? 'Restore this project before changing its team.'
                  : 'Assignments control project access and manager scope.'}
              </p>
              {loadingCandidates ? (
                <span className="project-assignment-loading">Loading active people…</span>
              ) : (
                <div className="project-candidate-list">
                  {candidates.map((candidate) => (
                    <label className="project-candidate" key={candidate.id}>
                      <input
                        type="checkbox"
                        checked={form.memberIds.includes(candidate.id)}
                        onChange={() => toggleAssignment('memberIds', candidate.id)}
                      />
                      <span className="people-avatar">{initials(candidate.name)}</span>
                      <span>
                        <strong>{candidate.name}</strong>
                        <small>{candidate.emp_code} · {candidate.department || 'No department'}</small>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
          )}

          {project && canEditDefinition && <section className="work-setup-account-actions"><h3>Project availability</h3><p>{dirty ? 'Save or discard your edits before changing availability.' : project.archived_at ? 'Restore to make this project available again.' : 'Archiving removes this project from new work choices. Existing reports are retained.'}</p><button type="button" className="btn btn-outline" disabled={saving || dirty} onClick={() => onArchive(project)}>{project.archived_at ? 'Restore project' : 'Archive project'}</button></section>}
          </fieldset>
          <div className="people-drawer-actions">
            <button type="button" className="btn btn-outline" onClick={requestClose} disabled={saving}>Cancel</button>
            <button
              type="submit"
              className="btn"
              disabled={saving || loadingCandidates || !dirty || (canEditDefinition && !project?.archived_at && form.managerIds.length === 0)}
            >
              {saving ? 'Saving…' : isCreate ? 'Create project' : 'Save changes'}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
};

const Projects = ({ mode = 'manage' }) => {
  const listSort = useListSort('projectList', [{ key: 'name', label: 'Project name', value: (item) => item.name }, { key: 'code', label: 'Code', value: (item) => item.code }, { key: 'managers', label: 'Managers', value: (item) => normaliseAssignments(item.managers).map((person) => person.name).join(', ') }, { key: 'people', label: 'Team size', value: (item) => normaliseAssignments(item.members).length }, { key: 'status', label: 'Status', value: (item) => item.archived_at ? 'Archived' : 'Active' }]);
  const { user } = useContext(AuthContext);
  const [projects, setProjects] = useState([]);
  const [directory, setDirectory] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [drawer, setDrawer] = useState(null);
  const [drawerError, setDrawerError] = useState('');
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('active');

  const canManageDefinitions = mode === 'setup'
    && hasPermission(user, PERMISSIONS.MANAGE_PROJECTS);
  const isSetupMode = mode === 'setup';
  const PageLayout = isSetupMode ? WorkSetupLayout : Layout;

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    setError('');

    const requests = [
      supabase.rpc('project_administration_overview'),
    ];

    if (canManageDefinitions) {
      requests.push(
        supabase
          .from('employees')
          .select('id, emp_code, name, department, role')
          .eq('status', 'Active')
          .order('name', { ascending: true }),
      );
    }

    const [projectResult, directoryResult] = await Promise.all(requests);
    const fetchError = projectResult.error || directoryResult?.error;

    if (fetchError) {
      setError(fetchError.message || 'Unable to load projects.');
    } else {
      setProjects(projectResult.data || []);
      setDirectory(directoryResult?.data || []);
    }
    setLoading(false);
    return { error: fetchError || null };
  }, [canManageDefinitions]);

  useEffect(() => {
    void fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    if (!notice) return undefined;
    const timeoutId = window.setTimeout(() => setNotice(''), 5000);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  const filteredProjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    return projects.filter((project) => {
      const matchesStatus = status === 'all'
        || (status === 'archived' ? project.archived_at : !project.archived_at);
      const matchesSearch = !query || [
        project.code,
        project.name,
        project.description,
        ...normaliseAssignments(project.managers).map((manager) => manager.name),
        ...normaliseAssignments(project.members).map((member) => member.name),
      ].some((value) => value?.toLowerCase().includes(query));
      return matchesStatus && matchesSearch;
    });
  }, [projects, search, status]);

  const activeCount = projects.filter((project) => !project.archived_at).length;
  const archivedCount = projects.length - activeCount;

  const openCreate = () => {
    setCandidates(directory);
    setDrawerError('');
    setDrawer({ project: null });
  };

  const openProject = async (project) => {
    setDrawerError('');
    setCandidates([]);
    setDrawer({ project });
    setLoadingCandidates(true);
    const { data, error: candidateError } = await supabase.rpc(
      'project_assignment_candidates',
      { target_project_id: project.id },
    );
    setLoadingCandidates(false);
    if (candidateError) {
      setDrawerError(candidateError.message || 'Unable to load assignment candidates.');
    } else {
      setCandidates(data || []);
    }
  };

  const syncAssignments = async (project, form) => {
    const existingManagers = new Set(normaliseAssignments(project.managers).map((manager) => manager.id));
    const existingMembers = new Set(normaliseAssignments(project.members).map((member) => member.id));
    const nextManagers = new Set(form.managerIds);
    const nextMembers = new Set(form.memberIds);

    if (canManageDefinitions) {
      for (const employeeId of nextManagers) {
        if (!existingManagers.has(employeeId)) {
          const { error: assignmentError } = await supabase.rpc('assign_project_manager', {
            target_project_id: project.id,
            manager_employee_id: employeeId,
          });
          if (assignmentError) throw assignmentError;
        }
      }
      for (const employeeId of existingManagers) {
        if (!nextManagers.has(employeeId)) {
          const { error: assignmentError } = await supabase.rpc('remove_project_manager', {
            target_project_id: project.id,
            manager_employee_id: employeeId,
          });
          if (assignmentError) throw assignmentError;
        }
      }
    }

    if (!canManageDefinitions && !project.archived_at) {
      for (const employeeId of nextMembers) {
        if (!existingMembers.has(employeeId)) {
          const { error: assignmentError } = await supabase.rpc('assign_project_member', {
            target_project_id: project.id,
            member_employee_id: employeeId,
          });
          if (assignmentError) throw assignmentError;
        }
      }
      for (const employeeId of existingMembers) {
        if (!nextMembers.has(employeeId)) {
          const { error: assignmentError } = await supabase.rpc('remove_project_member', {
            target_project_id: project.id,
            member_employee_id: employeeId,
          });
          if (assignmentError) throw assignmentError;
        }
      }
    }
  };

  const saveProject = async (form) => {
    setSaving(true);
    setDrawerError('');

    try {
      let actionLabel;
      if (!drawer.project) {
        const { data: createdData, error: createError } = await supabase.rpc('create_project_with_manager', {
          project_code: form.code,
          project_name: form.name,
          project_description: form.description,
          manager_employee_id: form.managerIds[0],
        });
        if (createError) throw createError;
        const createdProject = Array.isArray(createdData) ? createdData[0] : createdData;
        for (const employeeId of form.managerIds.slice(1)) {
          const { error: assignmentError } = await supabase.rpc('assign_project_manager', {
            target_project_id: createdProject.id,
            manager_employee_id: employeeId,
          });
          if (assignmentError) throw assignmentError;
        }
        actionLabel = `${form.name} was created.`;
      } else {
        if (canManageDefinitions) {
          if (form.managerIds.length === 0) {
            throw new Error('Every active project must have at least one manager.');
          }
          const { error: updateError } = await supabase.rpc('update_project_definition', {
            target_project_id: drawer.project.id,
            project_code: form.code,
            project_name: form.name,
            project_description: form.description,
          });
          if (updateError) throw updateError;
        }
        await syncAssignments(drawer.project, form);
        actionLabel = `${drawer.project.name} was updated.`;
      }

      setDrawer(null);
      const refreshResult = await fetchProjects();
      setNotice(refreshResult.error
        ? `${actionLabel} The project list could not be refreshed; use Try again below.`
        : actionLabel);
    } catch (saveError) {
      setDrawerError(saveError.message || 'Unable to save this project.');
    } finally {
      setSaving(false);
    }
  };

  const changeArchiveState = async (project) => {
    if (saving) return;
    setSaving(true); setDrawerError('');
    const shouldArchive = !project.archived_at;
    try {
      const { error: archiveError } = await supabase.rpc('set_project_archived', { target_project_id: project.id, should_archive: shouldArchive });
      if (archiveError) throw archiveError;
      setDrawer(null);
      const actionLabel = `${project.name} was ${shouldArchive ? 'archived' : 'restored'}.`;
      const refreshed = await fetchProjects();
      setNotice(refreshed.error ? `${actionLabel} Refresh the list to see the change.` : actionLabel);
    } catch (failure) { setDrawerError(failure.message || 'Unable to change project availability.'); }
    finally { setSaving(false); }
  };

  return (
    <PageLayout
      title={isSetupMode ? 'Project Setup' : 'Projects'}
      eyebrow={isSetupMode ? 'Work Setup' : 'Manage'}
      heading={isSetupMode ? 'Project Setup' : 'Projects'}
      description={canManageDefinitions
        ? 'Create, archive and maintain project definitions and accountable managers.'
        : 'Review permitted projects and manage their team assignments.'}
      actions={canManageDefinitions ? (
        <button type="button" className="btn" onClick={openCreate}>
          <i className="ri-add-line" />
          New project
        </button>
      ) : null}
    >
      {notice && (
        <div className="people-feedback people-feedback--success" role="status">
          <i className="ri-checkbox-circle-line" />
          {notice}
        </div>
      )}

      {!canManageDefinitions && (
        <div className="people-readonly-note">
          <i className="ri-team-line" />
          <div>
            <strong>Operational project view</strong>
            <span>Project definitions are read-only here; team assignments remain available.</span>
          </div>
        </div>
      )}

      {!isSetupMode && <div className="project-stats">
        <div className="people-stat">
          <span className="people-stat-icon"><i className="ri-briefcase-4-line" /></span>
          <div><strong>{projects.length}</strong><span>Visible projects</span></div>
        </div>
        <div className="people-stat">
          <span className="people-stat-icon people-stat-icon--active"><i className="ri-play-circle-line" /></span>
          <div><strong>{activeCount}</strong><span>Active</span></div>
        </div>
        <div className="people-stat">
          <span className="people-stat-icon project-stat-icon--archived"><i className="ri-archive-line" /></span>
          <div><strong>{archivedCount}</strong><span>Archived</span></div>
        </div>
      </div>}

      <section className={`card project-card${isSetupMode ? ' work-setup-list' : ''}`}>
        <div className="filter-bar people-filters">
          <label className="people-search">
            <i className="ri-search-line" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={isSetupMode ? "Search code, project or manager" : "Search projects, managers or team"}
              aria-label="Search projects"
            />
          </label>
          <div className="app-tabs" aria-label="Project status">
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
                {label}{isSetupMode && ` (${loading ? '…' : value === 'active' ? activeCount : value === 'archived' ? archivedCount : projects.length})`}
              </button>
            ))}
          </div>
        </div>

        {error && projects.length > 0 && (
          <AppState
            compact
            type="error"
            title="Project list could not be refreshed"
            message={error}
            action={<button type="button" className="btn btn-outline" onClick={fetchProjects}>Try again</button>}
          />
        )}

        {loading && projects.length === 0 ? (
          <AppState type="loading" title="Loading projects" message="Fetching the projects you are permitted to manage." />
        ) : error && projects.length === 0 ? (
          <AppState
            type="error"
            title="Unable to load projects"
            message={error}
            action={<button type="button" className="btn btn-outline" onClick={fetchProjects}>Try again</button>}
          />
        ) : filteredProjects.length === 0 ? (
          <AppState
            type="empty"
            title={projects.length ? 'No projects match this view' : 'No projects yet'}
            message={projects.length
              ? 'Try another search or project status.'
              : canManageDefinitions
                ? 'Create the first project with an accountable manager.'
                : 'No owned projects are assigned to you.'}
          />
        ) : isSetupMode ? (
          <div className="table-wrap"><SortableTable sortId="setupProjects" className="work-setup-table">
            <thead><tr><th>Code</th><th>Project</th><th>Managers</th><th>Status</th><th aria-label="Actions" /></tr></thead>
            <tbody>{filteredProjects.map((project) => <tr key={project.id}>
              <td data-label="Code">{project.code}</td>
              <td data-label="Project"><strong>{project.name}</strong></td>
              <td data-label="Managers">{normaliseAssignments(project.managers).map((person) => person.name).join(', ') || 'Not assigned'}</td>
              <td data-label="Status"><span className={`badge ${project.archived_at ? 'neutral' : 'success'}`}>{project.archived_at ? 'Archived' : 'Active'}</span></td>
              <td><button type="button" className="people-action-button" onClick={() => openProject(project)}>Edit</button></td>
            </tr>)}</tbody>
          </SortableTable></div>
        ) : (
          <div className="project-list">
            <ListSortControls sort={listSort} />
            {listSort.sort(filteredProjects).map((project) => (
              <article className={`project-row${project.archived_at ? ' project-row--archived' : ''}`} key={project.id}>
                <div className="project-row-main">
                  <span className="project-code">{project.code}</span>
                  <div>
                    <div className="project-title-line">
                      <h3>{project.name}</h3>
                      <span className={`badge ${project.archived_at ? 'neutral' : 'success'}`}>
                        {project.archived_at ? 'Archived' : 'Active'}
                      </span>
                    </div>
                    <p>{project.description || 'No description provided.'}</p>
                  </div>
                </div>

                <div className="project-assignment-summary">
                  <div>
                    <span>Managers</span>
                    <strong>{normaliseAssignments(project.managers).length}</strong>
                    <div className="project-avatar-stack">
                      {normaliseAssignments(project.managers).slice(0, 4).map((manager) => (
                        <span className="people-avatar" title={manager.name} key={manager.id}>{initials(manager.name)}</span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span>Team</span>
                    <strong>{normaliseAssignments(project.members).length}</strong>
                    <div className="project-avatar-stack">
                      {normaliseAssignments(project.members).slice(0, 4).map((member) => (
                        <span className="people-avatar" title={member.name} key={member.id}>{initials(member.name)}</span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="project-row-actions">
                  <Link className="people-action-button" to={`/analytics/workload?tab=projects&project=${project.id}`}>View project</Link>
                  <button type="button" className="people-action-button" onClick={() => openProject(project)}>
                    <i className="ri-team-line" />
                    {canManageDefinitions ? 'Manage' : 'Manage team'}
                  </button>
                  {canManageDefinitions && (
                    <button
                      type="button"
                      className={`people-action-button${project.archived_at ? '' : ' people-action-button--danger'}`}
                      onClick={() => changeArchiveState(project)}
                    >
                      <i className={project.archived_at ? 'ri-refresh-line' : 'ri-archive-line'} />
                      {project.archived_at ? 'Restore' : 'Archive'}
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {drawer && (
        <ProjectDrawer
          project={drawer.project}
          candidates={candidates}
          canManageDefinitions={canManageDefinitions}
          loadingCandidates={loadingCandidates}
          saving={saving}
          error={drawerError}
          onClose={() => setDrawer(null)}
          onSave={saveProject}
          onArchive={changeArchiveState}
        />
      )}
    </PageLayout>
  );
};

export default Projects;
