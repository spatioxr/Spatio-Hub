import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import AppState from '../components/AppState';
import { AuthContext } from '../context/AuthContext';
import { supabase } from '../utils/supabaseClient';
import { getRole, hasPermission, PERMISSIONS, ROLES } from '../utils/rbac';
import {
  ACTIVE_EMPLOYMENT_STATUS,
  ARCHIVED_EMPLOYMENT_STATUS,
  employmentStatusLabel,
  isActivePerson,
  isArchivedPerson,
} from '../utils/people.js';
import useDialogFocus from '../hooks/useDialogFocus';
import ContextNavigator from '../components/ContextNavigator';
import { getSequenceNavigation } from '../utils/sequenceNavigation';

const ROLE_OPTIONS = [
  { value: 'employee', label: 'Employee' },
  { value: 'manager', label: 'Manager' },
  { value: 'admin', label: 'Admin' },
  { value: 'superadmin', label: 'Superadmin' },
];

const STATUS_OPTIONS = ['Active', 'On Leave', 'On Notice', 'Released'];

const EMPTY_PRIVATE_DETAILS = {
  personal_email: '',
  gender: '',
  date_of_birth: '',
  marital_status: '',
  blood_group: '',
  address: '',
  qualification: '',
  emergency_contact_number: '',
  emergency_contact_name: '',
};

const EMPTY_FORM = {
  emp_code: '',
  name: '',
  email: '',
  phone_number: '',
  department: '',
  designation: '',
  role: 'employee',
  reports_to: '',
  date_of_joining: '',
  status: 'Active',
  is_leave_admin: false,
  ...EMPTY_PRIVATE_DETAILS,
};

const personToForm = (person) => (
  person
    ? {
      emp_code: person.emp_code || '',
      name: person.name || '',
      email: person.email || '',
      phone_number: person.phone_number || '',
      department: person.department || '',
      designation: person.designation || '',
      role: person.role || 'employee',
      reports_to: person.reports_to || '',
      date_of_joining: person.date_of_joining || '',
      status: person.status || 'Active',
      is_leave_admin: Boolean(person.is_leave_admin),
      personal_email: person.personal_email || '',
      gender: person.gender || '',
      date_of_birth: person.date_of_birth || '',
      marital_status: person.marital_status || '',
      blood_group: person.blood_group || '',
      address: person.address || '',
      qualification: person.qualification || '',
      emergency_contact_number: person.emergency_contact_number || '',
      emergency_contact_name: person.emergency_contact_name || '',
    }
    : EMPTY_FORM
);

const roleLabel = (role) => ROLE_OPTIONS.find((option) => option.value === role)?.label || role;

const statusTone = (status) => {
  if (status === ACTIVE_EMPLOYMENT_STATUS) return 'success';
  if (status === ARCHIVED_EMPLOYMENT_STATUS) return 'neutral';
  return 'warning';
};

const CopyContactButton = ({ label, value, onCopied }) => {
  if (!value) return null;

  const copyValue = async () => {
    try {
      await navigator.clipboard.writeText(value);
      onCopied(`${label} copied.`);
    } catch {
      onCopied(`Unable to copy ${label.toLowerCase()}.`);
    }
  };

  return (
    <button
      type="button"
      className="people-copy-button"
      onClick={copyValue}
      aria-label={`Copy ${label.toLowerCase()}`}
      title={`Copy ${label.toLowerCase()}`}
    >
      <i className="ri-file-copy-line" aria-hidden="true" />
    </button>
  );
};

const PersonDrawer = ({
  mode,
  person,
  people,
  currentUser,
  saving,
  error,
  navigation,
  onClose,
  onNavigate,
  onSave,
  onNotice,
  showPrivateDetails,
}) => {
  const readOnly = mode === 'view';
  const drawerRef = useDialogFocus(true, onClose, { closeDisabled: saving });
  const initialForm = useMemo(() => personToForm(person), [person]);
  const [form, setForm] = useState(initialForm);
  const hasUnsavedChanges = !readOnly
    && JSON.stringify(form) !== JSON.stringify(initialForm);

  const isSuperadmin = getRole(currentUser) === ROLES.SUPERADMIN;
  const availableRoles = isSuperadmin
    ? ROLE_OPTIONS
    : ROLE_OPTIONS.filter((option) => (
      ['employee', 'manager'].includes(option.value)
      || option.value === person?.role
    ));
  const roleLocked = !isSuperadmin && ['admin', 'superadmin'].includes(person?.role);
  const managerOptions = people.filter((candidate) => (
    isActivePerson(candidate) && candidate.id !== person?.id
  ));

  const handleChange = (event) => {
    if (event.target.name === 'phone_number') event.target.setCustomValidity('');
    setForm((current) => ({
      ...current,
      [event.target.name]: event.target.type === 'checkbox'
        ? event.target.checked
        : event.target.value,
    }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const phoneInput = event.currentTarget.elements.phone_number;
    const phoneDigits = form.phone_number.replace(/[^0-9]/g, '');
    if (form.phone_number && (phoneDigits.length < 7 || phoneDigits.length > 15)) {
      phoneInput.setCustomValidity('Enter a phone number containing 7 to 15 digits.');
      phoneInput.reportValidity();
      return;
    }
    if (!readOnly) onSave(form);
  };

  const navigateTo = (target) => {
    if (!target || saving) return;
    if (
      hasUnsavedChanges
      && !window.confirm('Discard the unsaved changes and open another person?')
    ) return;
    onNavigate(target);
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
          <div className="people-drawer-header-actions">
            {person && navigation?.total > 1 && (
              <ContextNavigator
                compact
                ariaLabel="Browse people"
                positionLabel={`${navigation.position} of ${navigation.total}`}
                previousLabel={navigation.previous
                  ? `Previous person: ${navigation.previous.name}`
                  : 'No previous person'}
                nextLabel={navigation.next
                  ? `Next person: ${navigation.next.name}`
                  : 'No next person'}
                previousDisabled={!navigation.previous}
                nextDisabled={!navigation.next}
                disabled={saving}
                onPrevious={() => navigateTo(navigation.previous)}
                onNext={() => navigateTo(navigation.next)}
              />
            )}
            <button type="button" className="people-icon-button" onClick={onClose} aria-label="Close">
              <i className="ri-close-line" />
            </button>
          </div>
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

          {isSuperadmin && !readOnly && (
            <label className="people-access-toggle">
              <input
                type="checkbox"
                name="is_leave_admin"
                checked={form.is_leave_admin}
                onChange={handleChange}
              />
              <span>
                <strong>Leave Admin access</strong>
                <small>Can review organisation leave, adjust balances, and manage holidays and attendance policy.</small>
              </span>
            </label>
          )}

          <div className="people-field">
            <label htmlFor="person-work-email">Work email *</label>
            <span className="people-contact-input">
              <input
                id="person-work-email"
                type="email"
                name="email"
                value={form.email}
                onChange={handleChange}
                disabled={readOnly}
                placeholder="name@company.com"
                required
              />
              <CopyContactButton label="Email" value={form.email} onCopied={onNotice} />
            </span>
            {!readOnly && mode === 'create' && (
              <small>The profile links automatically when an Auth user signs in with this email.</small>
            )}
          </div>

          <div className="people-field">
            <label htmlFor="person-phone-number">Phone number</label>
            <span className="people-contact-input">
              <input
                id="person-phone-number"
                type="tel"
                name="phone_number"
                value={form.phone_number}
                onChange={handleChange}
                disabled={readOnly}
                placeholder="Not available"
                pattern="[+]?[0-9 ()-]{7,25}"
                maxLength="25"
                title="Use 7–15 digits; spaces, brackets, hyphens and a leading + are allowed."
              />
              <CopyContactButton label="Phone number" value={form.phone_number} onCopied={onNotice} />
            </span>
            {readOnly && !form.phone_number
              ? <small>No phone number is available.</small>
              : !readOnly && <small>Optional. Include the country code for international numbers.</small>}
          </div>

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

          {showPrivateDetails && (
            <section className="people-private-details" aria-labelledby="private-details-heading">
              <div className="people-form-section-heading">
                <div>
                  <span className="page-eyebrow">Restricted</span>
                  <h3 id="private-details-heading">Private employee details</h3>
                </div>
                <span>Admin access only</span>
              </div>

              <div className="people-form-grid">
                <label className="people-field">
                  <span>Personal email</span>
                  <span className="people-contact-input">
                    <input
                      type="email"
                      name="personal_email"
                      value={form.personal_email}
                      onChange={handleChange}
                      disabled={readOnly}
                      placeholder="Not available"
                    />
                    <CopyContactButton label="Personal email" value={form.personal_email} onCopied={onNotice} />
                  </span>
                </label>
                <label className="people-field">
                  <span>Date of birth</span>
                  <input
                    type="date"
                    name="date_of_birth"
                    value={form.date_of_birth}
                    onChange={handleChange}
                    disabled={readOnly}
                  />
                </label>
              </div>

              <div className="people-form-grid">
                <label className="people-field">
                  <span>Gender</span>
                  <input name="gender" value={form.gender} onChange={handleChange} disabled={readOnly} placeholder="Not available" />
                </label>
                <label className="people-field">
                  <span>Marital status</span>
                  <input name="marital_status" value={form.marital_status} onChange={handleChange} disabled={readOnly} placeholder="Not available" />
                </label>
              </div>

              <div className="people-form-grid">
                <label className="people-field">
                  <span>Blood group</span>
                  <input name="blood_group" value={form.blood_group} onChange={handleChange} disabled={readOnly} placeholder="Not available" />
                </label>
                <label className="people-field">
                  <span>Qualification</span>
                  <input name="qualification" value={form.qualification} onChange={handleChange} disabled={readOnly} placeholder="Not available" />
                </label>
              </div>

              <label className="people-field">
                <span>Address</span>
                <span className="people-contact-input people-contact-input--textarea">
                  <textarea name="address" value={form.address} onChange={handleChange} disabled={readOnly} placeholder="Not available" rows="3" />
                  <CopyContactButton label="Address" value={form.address} onCopied={onNotice} />
                </span>
              </label>

              <div className="people-form-grid">
                <label className="people-field">
                  <span>Emergency contact name</span>
                  <input name="emergency_contact_name" value={form.emergency_contact_name} onChange={handleChange} disabled={readOnly} placeholder="Not available" />
                </label>
                <label className="people-field">
                  <span>Emergency contact number</span>
                  <span className="people-contact-input">
                    <input
                      type="tel"
                      name="emergency_contact_number"
                      value={form.emergency_contact_number}
                      onChange={handleChange}
                      disabled={readOnly}
                      placeholder="Not available"
                      maxLength="25"
                    />
                    <CopyContactButton label="Emergency contact" value={form.emergency_contact_number} onCopied={onNotice} />
                  </span>
                </label>
              </div>
            </section>
          )}

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
                  <option key={status} value={status}>{employmentStatusLabel(status)}</option>
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
      .select('id, emp_code, name, email, phone_number, department, designation, role, status, date_of_joining, reports_to, auth_id, must_change_password, temporary_password_issued_at, is_leave_admin')
      .order('name', { ascending: true });

    if (fetchError) {
      setError(fetchError.message || 'Unable to load people.');
      setPeople([]);
    } else {
      let visiblePeople = data || [];
      if (canManage) {
        const { data: privateRows, error: privateError } = await supabase
          .from('employee_private_details')
          .select('employee_id, personal_email, gender, date_of_birth, marital_status, blood_group, address, qualification, emergency_contact_number, emergency_contact_name');

        if (privateError) {
          setError(privateError.message || 'Unable to load private employee details.');
          setPeople([]);
          setLoading(false);
          return;
        }

        const privateByEmployee = new Map(
          (privateRows || []).map((row) => [row.employee_id, row]),
        );
        visiblePeople = visiblePeople.map((person) => ({
          ...person,
          ...(privateByEmployee.get(person.id) || EMPTY_PRIVATE_DETAILS),
        }));
      }
      setPeople(visiblePeople);
    }
    setLoading(false);
  }, [canManage]);

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
        person.phone_number,
        person.department,
        person.designation,
      ].some((value) => value?.toLowerCase().includes(query));
      const matchesDepartment = department === 'all' || person.department === department;
      const matchesRole = role === 'all' || person.role === role;
      const matchesStatus = status === 'all' || person.status === status;
      return matchesSearch && matchesDepartment && matchesRole && matchesStatus;
    });
  }, [department, people, role, search, status]);

  const drawerNavigation = useMemo(() => (
    drawer?.person
      ? getSequenceNavigation(filteredPeople, drawer.person.id)
      : null
  ), [drawer?.person, filteredPeople]);

  const canEditPerson = (person) => (
    canManage && (isSuperadmin || person.role !== 'superadmin')
  );

  const openDrawer = (mode, person = null) => {
    setDrawerError('');
    setDrawer({ mode, person });
  };

  const navigateDrawer = (person) => {
    setDrawerError('');
    setDrawer((current) => ({ ...current, person }));
  };

  const toRpcPayload = (form) => ({
    employee_code: form.emp_code,
    employee_name: form.name,
    work_email: form.email,
    employee_phone_number: form.phone_number || null,
    employee_department: form.department,
    employee_designation: form.designation,
    employee_role: form.role,
    manager_employee_id: form.reports_to || null,
    joining_date: form.date_of_joining || null,
    employment_status: form.status,
  });

  const toPrivateRpcPayload = (form, employeeId) => ({
    target_employee_id: employeeId,
    personal_email_value: form.personal_email || null,
    gender_value: form.gender || null,
    date_of_birth_value: form.date_of_birth || null,
    marital_status_value: form.marital_status || null,
    blood_group_value: form.blood_group || null,
    address_value: form.address || null,
    qualification_value: form.qualification || null,
    emergency_contact_number_value: form.emergency_contact_number || null,
    emergency_contact_name_value: form.emergency_contact_name || null,
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

    if (isSuperadmin && Boolean(savedPerson.is_leave_admin) !== Boolean(form.is_leave_admin)) {
      const { error: accessError } = await supabase.rpc('set_leave_admin_access', {
        target_employee_id: savedPerson.id,
        enabled: Boolean(form.is_leave_admin),
      });
      if (accessError) {
        setDrawerError(`The profile was saved, but Leave Admin access was not updated: ${accessError.message}`);
        setSaving(false);
        await fetchPeople();
        return;
      }
    }

    const { error: privateSaveError } = await supabase.rpc(
      'upsert_employee_private_details',
      toPrivateRpcPayload(form, savedPerson.id),
    );
    if (privateSaveError) {
      setDrawer({ mode: 'edit', person: { ...savedPerson, ...form } });
      setDrawerError(`The profile was saved, but private details were not updated: ${privateSaveError.message}`);
      setSaving(false);
      await fetchPeople();
      return;
    }

    setDrawer(null);
    setSaving(false);
    if (isCreate && isSuperadmin && isActivePerson(savedPerson)) {
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

  const toggleArchive = async (person) => {
    const shouldArchive = !isArchivedPerson(person);
    if (
      shouldArchive
      && !window.confirm(
        `Archive ${person.name}? Any linked login will be blocked, but their profile and work history will be retained.`,
      )
    ) return;

    setError('');
    const { error: saveError } = await supabase.rpc('update_employee_profile', {
      target_employee_id: person.id,
      ...toRpcPayload({
        ...person,
        reports_to: person.reports_to || '',
        date_of_joining: person.date_of_joining || '',
        status: shouldArchive ? ARCHIVED_EMPLOYMENT_STATUS : ACTIVE_EMPLOYMENT_STATUS,
      }),
    });

    if (saveError) {
      setError(saveError.message || 'Unable to change this person’s status.');
      return;
    }

    setNotice(
      shouldArchive
        ? `${person.name} was archived. Their profile and history were retained.`
        : `${person.name} was restored to Active.`,
    );
    await fetchPeople();
  };

  const activeCount = people.filter(isActivePerson).length;
  const archivedCount = people.filter(isArchivedPerson).length;

  return (
    <Layout
      title={isAccessMode ? 'Users & Access' : 'People'}
      eyebrow={isAccessMode ? 'Settings' : 'Manage'}
      heading={isAccessMode ? 'Users & Access' : 'People'}
      description={isAccessMode
        ? 'Manage work profiles, roles and portal access. Archived users keep their history but cannot access the portal.'
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
          <div>
            <strong>{people.length}</strong>
            <span>{isAccessMode ? 'Total profiles' : 'People in your scope'}</span>
          </div>
        </div>
        <div className="people-stat">
          <span className="people-stat-icon people-stat-icon--active"><i className="ri-user-follow-line" /></span>
          <div><strong>{activeCount}</strong><span>Active</span></div>
        </div>
        <div className="people-stat">
          <span className="people-stat-icon people-stat-icon--archived"><i className="ri-archive-line" /></span>
          <div><strong>{archivedCount}</strong><span>Archived</span></div>
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
              placeholder="Search name, ID, email, phone or title"
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
                <option key={item} value={item}>{employmentStatusLabel(item)}</option>
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
                    <tr className={isArchivedPerson(person) ? 'people-row--archived' : ''} key={person.id}>
                      <td data-label="Person">
                        <div className="people-person-cell">
                          <span className="people-avatar">
                            {person.name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()}
                          </span>
                          <div className="people-person-details">
                            <strong>{person.name}</strong>
                            <span>{person.emp_code}</span>
                            <span className="people-contact-row">
                              <span>{person.email}</span>
                              <CopyContactButton label="Email" value={person.email} onCopied={setNotice} />
                            </span>
                            {person.phone_number && (
                              <span className="people-contact-row">
                                <span>{person.phone_number}</span>
                                <CopyContactButton label="Phone number" value={person.phone_number} onCopied={setNotice} />
                              </span>
                            )}
                            {!person.phone_number && (
                              <span className="people-secondary">Phone not available</span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td data-label="Department">
                        <strong className="people-mobile-value">{person.department || 'Not assigned'}</strong>
                        <span className="people-secondary">{person.designation || 'No designation'}</span>
                      </td>
                      <td data-label="Role">
                        <div className="people-role-badges">
                          <span className="badge primary">{roleLabel(person.role)}</span>
                          {person.is_leave_admin && <span className="badge success">Leave Admin</span>}
                        </div>
                      </td>
                      <td data-label="Reports to">{manager?.name || 'Not assigned'}</td>
                      <td data-label="Status">
                        <span className={`badge ${statusTone(person.status)}`}>
                          {employmentStatusLabel(person.status)}
                        </span>
                      </td>
                      {isAccessMode && (
                        <td data-label="Login">
                          <span className={`badge ${isArchivedPerson(person) ? 'neutral' : !person.auth_id ? 'warning' : person.must_change_password ? 'primary' : 'success'}`}>
                            {isArchivedPerson(person)
                              ? 'Access blocked'
                              : !person.auth_id
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
                            className={`people-action-button ${isArchivedPerson(person) ? '' : 'people-action-button--danger'}`}
                            onClick={() => toggleArchive(person)}
                          >
                            <i className={isArchivedPerson(person) ? 'ri-refresh-line' : 'ri-archive-line'} />
                            {isArchivedPerson(person) ? 'Restore' : 'Archive'}
                          </button>
                        )}
                        {isAccessMode && isSuperadmin && person.id !== user.id && isActivePerson(person) && (
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
          navigation={drawerNavigation}
          onClose={() => setDrawer(null)}
          onNavigate={navigateDrawer}
          onSave={savePerson}
          onNotice={setNotice}
          showPrivateDetails={canManage}
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
