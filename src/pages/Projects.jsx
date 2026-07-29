import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import AppState from '../components/AppState';
import { AuthContext } from '../context/AuthContext';
import { supabase } from '../utils/supabaseClient';
import { hasPermission, PERMISSIONS } from '../utils/rbac';

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
    <div className="drawer-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="drawer project-drawer" aria-label={isCreate ? 'Create project' : `Manage ${project.name}`}>
        <div className="people-drawer-header">
          <div>
            <span className="page-eyebrow">{isCreate ? 'Project setup' : 'Project administration'}</span>
            <h2>{isCreate ? 'Create project' : project.name}</h2>
            <p>
              {canEditDefinition
                ? 'Keep the project definition and its explicit assignments together.'
                : 'Project details are read-only. You can manage this owned project’s team.'}
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

        <form className="people-form project-form" onSubmit={handleSubmit}>
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

          {!isCreate && (
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

          <div className="people-drawer-actions">
            <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
            <button
              type="submit"
              className="btn"
              disabled={saving || loadingCandidates || (isCreate && form.managerIds.length === 0)}
            >
              {saving ? 'Saving…' : isCreate ? 'Create project' : 'Save changes'}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
};

const Projects = () => {
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

  const canManageDefinitions = hasPermission(user, PERMISSIONS.MANAGE_PROJECTS);

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
      setProjects([]);
      setDirectory([]);
      setError(fetchError.message || 'Unable to load projects.');
    } else {
      setProjects(projectResult.data || []);
      setDirectory(directoryResult?.data || []);
    }
    setLoading(false);
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

    if (!project.archived_at) {
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
        setNotice(`${form.name} was created.`);
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
        setNotice(`${drawer.project.name} was updated.`);
      }

      setDrawer(null);
      await fetchProjects();
    } catch (saveError) {
      setDrawerError(saveError.message || 'Unable to save this project.');
    } finally {
      setSaving(false);
    }
  };

  const changeArchiveState = async (project) => {
    setError('');
    const shouldArchive = !project.archived_at;
    const { error: archiveError } = await supabase.rpc('set_project_archived', {
      target_project_id: project.id,
      should_archive: shouldArchive,
    });

    if (archiveError) {
      setError(archiveError.message || 'Unable to change this project’s status.');
      return;
    }

    setNotice(`${project.name} was ${shouldArchive ? 'archived' : 'restored'}.`);
    await fetchProjects();
  };

  return (
    <Layout
      title="Projects"
      eyebrow="Administration"
      heading="Projects"
      description={canManageDefinitions
        ? 'Manage project definitions, ownership and explicit team access.'
        : 'View projects you own and manage their team assignments.'}
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
            <strong>Owned projects only</strong>
            <span>Project definitions are read-only; team assignments remain available.</span>
          </div>
        </div>
      )}

      <div className="project-stats">
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
      </div>

      <section className="card project-card">
        <div className="filter-bar people-filters">
          <label className="people-search">
            <i className="ri-search-line" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search projects, managers or team"
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
                onClick={() => setStatus(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <AppState type="loading" title="Loading projects" message="Fetching the projects you are permitted to manage." />
        ) : error ? (
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
        ) : (
          <div className="project-list">
            {filteredProjects.map((project) => (
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
        />
      )}
    </Layout>
  );
};

export default Projects;
