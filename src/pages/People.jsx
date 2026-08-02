import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import AppState from '../components/AppState';
import { AuthContext } from '../context/AuthContext';
import { supabase } from '../utils/supabaseClient';
import { getRole, hasPermission, PERMISSIONS, ROLES } from '../utils/rbac';
import useDialogFocus from '../hooks/useDialogFocus';

const ROLE_OPTIONS = [
  { value: 'employee', label: 'Employee' },
  { value: 'manager', label: 'Manager' },
  { value: 'admin', label: 'Admin' },
  { value: 'superadmin', label: 'Superadmin' },
];

const STATUS_OPTIONS = ['Active', 'On Leave', 'On Notice', 'Released'];

const EMPTY_FORM = {
  emp_code: '',
  name: '',
  email: '',
  department: '',
  designation: '',
  role: 'employee',
  reports_to: '',
  date_of_joining: '',
  status: 'Active',
};

const roleLabel = (role) => ROLE_OPTIONS.find((option) => option.value === role)?.label || role;

const statusTone = (status) => {
  if (status === 'Active') return 'success';
  if (status === 'Released') return 'danger';
  return 'warning';
};

const PersonDrawer = ({
  mode,
  person,
  people,
  currentUser,
  saving,
  error,
  onClose,
  onSave,
}) => {
  const readOnly = mode === 'view';
  const drawerRef = useDialogFocus(true, onClose, { closeDisabled: saving });
  const [form, setForm] = useState(() => (
    person
      ? {
        emp_code: person.emp_code || '',
        name: person.name || '',
        email: person.email || '',
        department: person.department || '',
        designation: person.designation || '',
        role: person.role || 'employee',
        reports_to: person.reports_to || '',
        date_of_joining: person.date_of_joining || '',
        status: person.status || 'Active',
      }
      : EMPTY_FORM
  ));

  const isSuperadmin = getRole(currentUser) === ROLES.SUPERADMIN;
  const availableRoles = isSuperadmin
    ? ROLE_OPTIONS
    : ROLE_OPTIONS.filter((option) => (
      ['employee', 'manager'].includes(option.value)
      || option.value === person?.role
    ));
  const roleLocked = !isSuperadmin && ['admin', 'superadmin'].includes(person?.role);
  const managerOptions = people.filter((candidate) => (
    candidate.status === 'Active' && candidate.id !== person?.id
  ));

  const handleChange = (event) => {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!readOnly) onSave(form);
  };

  return (
    <div className="drawer-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <aside
        ref={drawerRef}
        className="drawer people-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="person-drawer-title"
        tabIndex="-1"
      >
        <div className="people-drawer-header">
          <div>
            <span className="page-eyebrow">{readOnly ? 'Profile' : 'People management'}</span>
            <h2 id="person-drawer-title">{mode === 'create' ? 'Add person' : readOnly ? person.name : `Edit ${person.name}`}</h2>
            <p>
              {readOnly
                ? 'Project-team profile details are read-only.'
                : 'Keep this profile limited to Phase 1 work information.'}
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

        <form className="people-form" onSubmit={handleSubmit}>
          <div className="people-form-grid">
            <label className="people-field">
              <span>Employee ID *</span>
              <input
                name="emp_code"
                value={form.emp_code}
                onChange={handleChange}
                disabled={readOnly}
                placeholder="STS002"
                required
              />
            </label>
            <label className="people-field">
              <span>Full name *</span>
              <input
                name="name"
                value={form.name}
                onChange={handleChange}
                disabled={readOnly}
                placeholder="Employee name"
                required
              />
            </label>
          </div>

          <label className="people-field">
            <span>Work email *</span>
            <input
              type="email"
              name="email"
              value={form.email}
              onChange={handleChange}
              disabled={readOnly}
              placeholder="name@company.com"
              required
            />
            {!readOnly && mode === 'create' && (
              <small>The profile links automatically when an Auth user signs in with this email.</small>
            )}
          </label>

          <div className="people-form-grid">
            <label className="people-field">
              <span>Department</span>
              <input
                name="department"
                value={form.department}
                onChange={handleChange}
                disabled={readOnly}
                placeholder="Department"
              />
            </label>
            <label className="people-field">
              <span>Designation</span>
              <input
                name="designation"
                value={form.designation}
                onChange={handleChange}
                disabled={readOnly}
                placeholder="Role or title"
              />
            </label>
          </div>

          <div className="people-form-grid">
            <label className="people-field">
              <span>Application role *</span>
              <select
                name="role"
                value={form.role}
                onChange={handleChange}
                disabled={readOnly || roleLocked}
              >
                {availableRoles.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              {!readOnly && roleLocked && (
                <small>Only a superadmin can grant or remove privileged roles.</small>
              )}
            </label>
            <label className="people-field">
              <span>Status *</span>
              <select name="status" value={form.status} onChange={handleChange} disabled={readOnly}>
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>{status === 'Released' ? 'Inactive' : status}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="people-form-grid">
            <label className="people-field">
              <span>Reporting manager</span>
              <select name="reports_to" value={form.reports_to} onChange={handleChange} disabled={readOnly}>
                <option value="">Not assigned</option>
                {managerOptions.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name} ({candidate.emp_code})
                  </option>
                ))}
              </select>
            </label>
            <label className="people-field">
              <span>Joining date</span>
              <input
                type="date"
                name="date_of_joining"
                value={form.date_of_joining}
                onChange={handleChange}
                disabled={readOnly}
              />
            </label>
          </div>

          <div className="people-drawer-actions">
            <button type="button" className="btn btn-outline" onClick={onClose}>
              {readOnly ? 'Close' : 'Cancel'}
            </button>
            {!readOnly && (
              <button type="submit" className="btn" disabled={saving}>
                {saving ? 'Saving…' : mode === 'create' ? 'Add person' : 'Save changes'}
              </button>
            )}
          </div>
        </form>
      </aside>
    </div>
  );
};

const TemporaryPasswordDialog = ({ credential, onClose }) => {
  const dialogRef = useDialogFocus(true, onClose);
  const [copied, setCopied] = useState(false);

  const copyPassword = async () => {
    try {
      await navigator.clipboard.writeText(credential.temporaryPassword);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="drawer-backdrop credential-dialog-backdrop">
      <section
        ref={dialogRef}
        className="credential-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="credential-dialog-title"
        tabIndex="-1"
      >
        <span className="credential-dialog-icon" aria-hidden="true">
          <i className="ri-key-2-line" />
        </span>
        <span className="page-eyebrow">Temporary login</span>
        <h2 id="credential-dialog-title">
          {credential.action === 'provision' ? 'Login created' : 'Password reset'}
        </h2>
        <p>
          Share this password securely with <strong>{credential.personName}</strong>.
          It will not be shown again after this dialog closes.
        </p>

        <div className="credential-password-row">
          <code>{credential.temporaryPassword}</code>
          <button type="button" className="btn btn-outline" onClick={copyPassword}>
            <i className={copied ? 'ri-check-line' : 'ri-file-copy-line'} aria-hidden="true" />
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>

        <div className="credential-dialog-note">
          <i className="ri-shield-check-line" aria-hidden="true" />
          The user must replace this password immediately after signing in.
        </div>

        {credential.warning && (
          <div className="people-feedback people-feedback--error" role="alert">
            <i className="ri-error-warning-line" aria-hidden="true" />
            {credential.warning}
          </div>
        )}

        <button type="button" className="btn credential-dialog-done" onClick={onClose}>
          I have saved it securely
        </button>
      </section>
    </div>
  );
};

const People = ({ mode = 'directory' }) => {
  const { user } = useContext(AuthContext);
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('all');
  const [role, setRole] = useState('all');
  const [status, setStatus] = useState('Active');
  const [drawer, setDrawer] = useState(null);
  const [drawerError, setDrawerError] = useState('');
  const [saving, setSaving] = useState(false);
  const [credential, setCredential] = useState(null);
  const [credentialError, setCredentialError] = useState('');
  const [credentialActionId, setCredentialActionId] = useState('');

  const hasPeopleManagement = hasPermission(user, PERMISSIONS.MANAGE_PEOPLE);
  const canManage = mode === 'access' && hasPeopleManagement;
  const isSuperadmin = getRole(user) === ROLES.SUPERADMIN;
  const isAccessMode = mode === 'access';

  const fetchPeople = useCallback(async () => {
    setLoading(true);
    setError('');

    const { data, error: fetchError } = await supabase
      .from('employees')
      .select('id, emp_code, name, email, department, designation, role, status, date_of_joining, reports_to, auth_id, must_change_password, temporary_password_issued_at')
      .order('name', { ascending: true });

    if (fetchError) {
      setError(fetchError.message || 'Unable to load people.');
      setPeople([]);
    } else {
      setPeople(data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchPeople();
  }, [fetchPeople]);

  useEffect(() => {
    if (!notice) return undefined;
    const timeoutId = window.setTimeout(() => setNotice(''), 5000);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  const departments = useMemo(() => (
    [...new Set(people.map((person) => person.department).filter(Boolean))].sort()
  ), [people]);

  const peopleById = useMemo(
    () => new Map(people.map((person) => [person.id, person])),
    [people],
  );

  const filteredPeople = useMemo(() => {
    const query = search.trim().toLowerCase();
    return people.filter((person) => {
      const matchesSearch = !query || [
        person.name,
        person.emp_code,
        person.email,
        person.department,
        person.designation,
      ].some((value) => value?.toLowerCase().includes(query));
      const matchesDepartment = department === 'all' || person.department === department;
      const matchesRole = role === 'all' || person.role === role;
      const matchesStatus = status === 'all' || person.status === status;
      return matchesSearch && matchesDepartment && matchesRole && matchesStatus;
    });
  }, [department, people, role, search, status]);

  const canEditPerson = (person) => (
    canManage && (isSuperadmin || person.role !== 'superadmin')
  );

  const openDrawer = (mode, person = null) => {
    setDrawerError('');
    setDrawer({ mode, person });
  };

  const toRpcPayload = (form) => ({
    employee_code: form.emp_code,
    employee_name: form.name,
    work_email: form.email,
    employee_department: form.department,
    employee_designation: form.designation,
    employee_role: form.role,
    manager_employee_id: form.reports_to || null,
    joining_date: form.date_of_joining || null,
    employment_status: form.status,
  });

  const credentialErrorMessage = async (functionError) => {
    let message = functionError?.message || 'Unable to manage login credentials.';
    try {
      const responseBody = await functionError?.context?.json();
      message = responseBody?.error || message;
    } catch {
      // The Functions client may already have consumed a non-JSON response.
    }
    return message;
  };

  const manageTemporaryPassword = async (person, action, profileWasCreated = false) => {
    setCredentialError('');
    setCredentialActionId(person.id);

    const { data, error: functionError } = await supabase.functions.invoke('user-credentials', {
      body: { action, employeeId: person.id },
    });

    setCredentialActionId('');

    if (functionError || !data?.temporaryPassword) {
      const message = await credentialErrorMessage(functionError);
      setCredentialError(
        profileWasCreated
          ? `${person.name} was added, but login creation failed: ${message}`
          : message,
      );
      await fetchPeople();
      return false;
    }

    setCredential({
      action,
      personName: person.name,
      temporaryPassword: data.temporaryPassword,
      warning: data.warning,
    });
    setNotice(
      action === 'provision'
        ? `${person.name} was added and their login was created.`
        : `${person.name} received a new temporary password.`,
    );
    await fetchPeople();
    return true;
  };

  const savePerson = async (form) => {
    setSaving(true);
    setDrawerError('');
    const isCreate = drawer.mode === 'create';
    const payload = toRpcPayload(form);
    if (!isCreate) payload.target_employee_id = drawer.person.id;

    const { data: savedPerson, error: saveError } = await supabase.rpc(
      isCreate ? 'create_employee_profile' : 'update_employee_profile',
      payload,
    );

    if (saveError) {
      setDrawerError(saveError.message || 'Unable to save this person.');
      setSaving(false);
      return;
    }

    setDrawer(null);
    setSaving(false);
    if (isCreate && isSuperadmin && savedPerson?.status === 'Active') {
      await manageTemporaryPassword(savedPerson, 'provision', true);
    } else {
      setNotice(isCreate ? `${form.name} was added.` : `${form.name} was updated.`);
      await fetchPeople();
    }
  };

  const handleCredentialAction = async (person) => {
    const action = person.auth_id ? 'reset' : 'provision';
    if (
      action === 'reset'
      && !window.confirm(
        `Reset ${person.name}’s password? Their existing password will stop working and a new temporary password will be shown once.`,
      )
    ) return;

    await manageTemporaryPassword(person, action);
  };

  const changeStatus = async (person, nextStatus) => {
    setError('');
    const { error: saveError } = await supabase.rpc('update_employee_profile', {
      target_employee_id: person.id,
      ...toRpcPayload({
        ...person,
        reports_to: person.reports_to || '',
        date_of_joining: person.date_of_joining || '',
        status: nextStatus,
      }),
    });

    if (saveError) {
      setError(saveError.message || 'Unable to change this person’s status.');
      return;
    }

    setNotice(
      nextStatus === 'Active'
        ? `${person.name} was reactivated.`
        : `${person.name} was deactivated. Their history was retained.`,
    );
    await fetchPeople();
  };

  const activeCount = people.filter((person) => person.status === 'Active').length;

  return (
    <Layout
      title={isAccessMode ? 'Users & Access' : 'People'}
      eyebrow={isAccessMode ? 'Settings' : 'Manage'}
      heading={isAccessMode ? 'Users & Access' : 'People'}
      description={isAccessMode
        ? 'Manage the work profiles, roles and employment status that power Phase 1 access.'
        : hasPeopleManagement
          ? 'Browse the organisation directory. User changes remain in Settings.'
          : 'View people assigned to projects you manage.'}
      actions={canManage ? (
        <button type="button" className="btn" onClick={() => openDrawer('create')}>
          <i className="ri-user-add-line" />
          Add person
        </button>
      ) : null}
    >
      {notice && (
        <div className="people-feedback people-feedback--success" role="status">
          <i className="ri-checkbox-circle-line" />
          {notice}
        </div>
      )}

      {credentialError && (
        <div className="people-feedback people-feedback--error" role="alert">
          <i className="ri-error-warning-line" aria-hidden="true" />
          {credentialError}
        </div>
      )}

      {!canManage && (
        <div className="people-readonly-note">
          <i className="ri-eye-line" />
          <div>
            <strong>Read-only directory</strong>
            <span>
              {hasPeopleManagement
                ? 'Use Settings → Users & Access to add people or change access.'
                : 'You can see your profile and people assigned to projects you manage.'}
            </span>
          </div>
        </div>
      )}

      <div className="people-stats">
        <div className="people-stat">
          <span className="people-stat-icon"><i className="ri-team-line" /></span>
          <div><strong>{people.length}</strong><span>Visible people</span></div>
        </div>
        <div className="people-stat">
          <span className="people-stat-icon people-stat-icon--active"><i className="ri-user-follow-line" /></span>
          <div><strong>{activeCount}</strong><span>Active</span></div>
        </div>
      </div>

      <section className="card people-card">
        <div className="filter-bar people-filters">
          <label className="people-search">
            <i className="ri-search-line" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, ID, email or title"
              aria-label="Search people"
            />
          </label>
          <div className="people-filter-selects">
            <select value={department} onChange={(event) => setDepartment(event.target.value)} aria-label="Filter by department">
              <option value="all">All departments</option>
              {departments.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <select value={role} onChange={(event) => setRole(event.target.value)} aria-label="Filter by role">
              <option value="all">All roles</option>
              {ROLE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status">
              <option value="all">All statuses</option>
              {STATUS_OPTIONS.map((item) => (
                <option key={item} value={item}>{item === 'Released' ? 'Inactive' : item}</option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <AppState type="loading" title="Loading people" message="Fetching the profiles you are permitted to see." />
        ) : error ? (
          <AppState
            type="error"
            title="Unable to load people"
            message={error}
            action={<button type="button" className="btn btn-outline" onClick={fetchPeople}>Try again</button>}
          />
        ) : filteredPeople.length === 0 ? (
          <AppState
            type="empty"
            title="No people match these filters"
            message="Try a different search, department, role or status."
          />
        ) : (
          <div className="table-wrap">
            <table className="people-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Department</th>
                  <th>Role</th>
                  <th>Reports to</th>
                  <th>Status</th>
                  {isAccessMode && <th>Login</th>}
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {filteredPeople.map((person) => {
                  const manager = peopleById.get(person.reports_to);
                  return (
                    <tr key={person.id}>
                      <td data-label="Person">
                        <div className="people-person-cell">
                          <span className="people-avatar">
                            {person.name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()}
                          </span>
                          <div>
                            <strong>{person.name}</strong>
                            <span>{person.emp_code} · {person.email}</span>
                          </div>
                        </div>
                      </td>
                      <td data-label="Department">
                        <strong className="people-mobile-value">{person.department || 'Not assigned'}</strong>
                        <span className="people-secondary">{person.designation || 'No designation'}</span>
                      </td>
                      <td data-label="Role">
                        <span className="badge primary">{roleLabel(person.role)}</span>
                      </td>
                      <td data-label="Reports to">{manager?.name || 'Not assigned'}</td>
                      <td data-label="Status">
                        <span className={`badge ${statusTone(person.status)}`}>
                          {person.status === 'Released' ? 'Inactive' : person.status}
                        </span>
                      </td>
                      {isAccessMode && (
                        <td data-label="Login">
                          <span className={`badge ${!person.auth_id ? 'warning' : person.must_change_password ? 'primary' : 'success'}`}>
                            {!person.auth_id
                              ? 'No login'
                              : person.must_change_password
                                ? 'Change required'
                                : 'Active'}
                          </span>
                        </td>
                      )}
                      <td className="people-row-actions">
                        <button
                          type="button"
                          className="people-action-button"
                          onClick={() => openDrawer(canEditPerson(person) ? 'edit' : 'view', person)}
                        >
                          <i className={canEditPerson(person) ? 'ri-edit-line' : 'ri-eye-line'} />
                          {canEditPerson(person) ? 'Edit' : 'View'}
                        </button>
                        {canEditPerson(person) && person.id !== user.id && (
                          <button
                            type="button"
                            className={`people-action-button ${person.status === 'Released' ? '' : 'people-action-button--danger'}`}
                            onClick={() => changeStatus(person, person.status === 'Released' ? 'Active' : 'Released')}
                          >
                            <i className={person.status === 'Released' ? 'ri-user-follow-line' : 'ri-user-unfollow-line'} />
                            {person.status === 'Released' ? 'Reactivate' : 'Deactivate'}
                          </button>
                        )}
                        {isAccessMode && isSuperadmin && person.id !== user.id && person.status === 'Active' && (
                          <button
                            type="button"
                            className="people-action-button"
                            onClick={() => handleCredentialAction(person)}
                            disabled={credentialActionId === person.id}
                          >
                            <i className={person.auth_id ? 'ri-key-2-line' : 'ri-user-add-line'} aria-hidden="true" />
                            {credentialActionId === person.id
                              ? 'Working…'
                              : person.auth_id
                                ? 'Reset password'
                                : 'Create login'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {drawer && (
        <PersonDrawer
          key={`${drawer.mode}-${drawer.person?.id || 'new'}`}
          mode={drawer.mode}
          person={drawer.person}
          people={people}
          currentUser={user}
          saving={saving}
          error={drawerError}
          onClose={() => setDrawer(null)}
          onSave={savePerson}
        />
      )}
      {credential && (
        <TemporaryPasswordDialog
          credential={credential}
          onClose={() => setCredential(null)}
        />
      )}
    </Layout>
  );
};

export default People;
