import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import AppState from '../components/AppState';
import { AuthContext } from '../context/AuthContext';
import { supabase } from '../utils/supabaseClient';
import { getRole, hasPermission, PERMISSIONS, ROLES } from '../utils/rbac';

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
    : ROLE_OPTIONS.filter((option) => option.value !== 'superadmin');
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
      <aside className="drawer people-drawer" aria-label={`${mode === 'create' ? 'Add' : readOnly ? 'View' : 'Edit'} person`}>
        <div className="people-drawer-header">
          <div>
            <span className="page-eyebrow">{readOnly ? 'Profile' : 'People management'}</span>
            <h2>{mode === 'create' ? 'Add person' : readOnly ? person.name : `Edit ${person.name}`}</h2>
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
              <select name="role" value={form.role} onChange={handleChange} disabled={readOnly}>
                {availableRoles.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
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

const People = () => {
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

  const canManage = hasPermission(user, PERMISSIONS.MANAGE_PEOPLE);
  const isSuperadmin = getRole(user) === ROLES.SUPERADMIN;

  const fetchPeople = useCallback(async () => {
    setLoading(true);
    setError('');

    const { data, error: fetchError } = await supabase
      .from('employees')
      .select('id, emp_code, name, email, department, designation, role, status, date_of_joining, reports_to, auth_id')
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

  const savePerson = async (form) => {
    setSaving(true);
    setDrawerError('');
    const isCreate = drawer.mode === 'create';
    const payload = toRpcPayload(form);
    if (!isCreate) payload.target_employee_id = drawer.person.id;

    const { error: saveError } = await supabase.rpc(
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
    setNotice(isCreate ? `${form.name} was added.` : `${form.name} was updated.`);
    await fetchPeople();
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
      title="People"
      eyebrow="Organisation"
      heading="People"
      description={canManage
        ? 'Manage the work profiles that power Phase 1 access and reporting.'
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

      {!canManage && (
        <div className="people-readonly-note">
          <i className="ri-eye-line" />
          <div>
            <strong>Read-only project view</strong>
            <span>You can see your profile and people assigned to projects you manage.</span>
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
    </Layout>
  );
};

export default People;
