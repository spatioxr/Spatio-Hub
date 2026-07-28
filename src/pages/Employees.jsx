import React, { useContext, useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { AuthContext } from '../context/AuthContext';
import { supabase } from '../utils/supabaseClient';
import { getManagedDepartments } from '../utils/rbac';

/* ─── Status badge helper ─────────────────────────────── */
const statusColor = (s) => {
  if (s === 'Active') return { bg: '#D1FAE5', color: '#006742' };
  if (s === 'On Notice') return { bg: '#FEF3C7', color: '#CA8A04' };
  if (s === 'Released') return { bg: '#F2F2F2', color: '#494949' };
  return { bg: '#E8E8E8', color: '#646465' };
};

/* ─── Avatar cell: shows photo or initials ─────────────── */
const EmpAvatar = ({ emp, size = 36 }) => {
  if (emp.avatar_url) {
    return (
      <img
        src={emp.avatar_url}
        alt={emp.name}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
      />
    );
  }
  const initials = emp.name ? emp.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() : '?';
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: 'linear-gradient(135deg, #003B2C 0%, #00A87E 100%)',
      color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 700, fontSize: size * 0.35, flexShrink: 0
    }}>
      {initials}
    </div>
  );
};

/* ─── Employee Detail Popup ───────────────────────────── */
const EmployeeDetailModal = ({ emp, onClose, onEdit, canEdit }) => {
  const sc = statusColor(emp.status);
  return (
    <div className="salary-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="salary-modal" style={{ maxWidth: 420, textAlign: 'center' }}>
        {/* Header close button */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.5rem' }}>
          <button className="salary-modal-close" onClick={onClose}><i className="ri-close-line" /></button>
        </div>

        {/* Big centered profile picture */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
          <EmpAvatar emp={emp} size={100} />
        </div>

        <h3 style={{ fontSize: '1.3rem', fontWeight: 700, color: '#000', marginBottom: '0.25rem' }}>{emp.name}</h3>
        <p style={{ fontSize: '0.9rem', color: '#646465', marginBottom: '0.75rem' }}>{emp.designation}</p>
        
        <div style={{ marginBottom: '1.25rem' }}>
          <span style={{ ...sc, padding: '3px 14px', borderRadius: 20, fontSize: '0.78rem', fontWeight: 700, display: 'inline-block' }}>
            {emp.status || 'Active'}
          </span>
        </div>

        {/* Details list */}
        <div style={{ textAlign: 'left', background: '#F4F4F4', borderRadius: 12, padding: '0.5rem', marginBottom: '1.25rem' }}>
          {[
            { icon: 'ri-id-card-line',      label: 'EMP Code',       value: emp.emp_code },
            { icon: 'ri-briefcase-line',    label: 'Department',     value: emp.department },
            { icon: 'ri-user-settings-line',label: 'Designation',    value: emp.designation },
            { icon: 'ri-shield-user-line',  label: 'Role',           value: emp.role + (emp.role === 'admin' && emp.managed_department ? ` (${emp.managed_department})` : '') },
            { icon: 'ri-mail-line',         label: 'Email',          value: emp.email },
            { icon: 'ri-calendar-line',     label: 'Date of Joining',value: emp.date_of_joining
                ? new Date(emp.date_of_joining + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
                : '-' },
            ...(emp.reports_to ? [{ icon: 'ri-user-star-line', label: 'Reports To (ID)', value: emp.reports_to }] : [])
          ].map((row, i, arr) => (
            <div
              key={row.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.875rem',
                padding: '0.75rem',
                borderBottom: i < arr.length - 1 ? '1px solid #E8E8E8' : 'none',
              }}
            >
              <div style={{ width: 32, height: 32, background: '#E8F2EF', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <i className={row.icon} style={{ color: '#006742', fontSize: '1rem' }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.72rem', color: '#646465', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{row.label}</div>
                <div style={{ fontSize: '0.9rem', color: '#000', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.value || '—'}</div>
              </div>
            </div>
          ))}
        </div>

        {canEdit && (
          <button
            className="btn-teal"
            style={{ width: '100%' }}
            onClick={() => { onClose(); onEdit(emp); }}
          >
            <i className="ri-pencil-line" /> Edit Employee
          </button>
        )}
      </div>
    </div>
  );
};

/* ─── Add / Edit Employee Modal ───────────────────────── */
const EmployeeModal = ({ onClose, onSave, initialData, user }) => {
  const isEditing = !!initialData?.id;
  const [empCode, setEmpCode] = useState(initialData?.emp_code || '');
  const [name, setName] = useState(initialData?.name || '');
  const [email, setEmail] = useState(initialData?.email || '');
  const [department, setDepartment] = useState(initialData?.department || '');
  const [designation, setDesignation] = useState(initialData?.designation || '');
  const [dateOfJoining, setDateOfJoining] = useState(initialData?.date_of_joining || '');
  const [role, setRole] = useState(initialData?.role || 'employee');
  const [status, setStatus] = useState(initialData?.status || 'Active');
  const [managedDepartment, setManagedDepartment] = useState(initialData?.managed_department || '');
  const [reportsTo, setReportsTo] = useState(initialData?.reports_to || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [potentialManagers, setPotentialManagers] = useState([]);

  useEffect(() => {
    const fetchManagers = async () => {
      const { data } = await supabase.from('employees')
        .select('id, name, role')
        .in('role', ['admin', 'manager', 'head'])
        .order('name');
      if (data) setPotentialManagers(data);
    };
    fetchManagers();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!empCode || !name || !email || !department || !role || !designation || !dateOfJoining) return;
    setIsSubmitting(true);
    await onSave({
      id: initialData?.id,
      emp_code: empCode,
      name,
      email,
      department,
      designation,
      date_of_joining: dateOfJoining,
      role,
      status,
      reports_to: reportsTo || null,
      managed_department: (role === 'admin' || role === 'manager') ? managedDepartment : null
    });
    setIsSubmitting(false);
  };

  return (
    <div className="salary-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="salary-modal" style={{ maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="salary-modal-header">
          <div>
            <h3 className="salary-modal-title">{isEditing ? 'Edit Employee' : 'Add New Employee'}</h3>
            <p className="salary-modal-sub">Enter employee details below</p>
          </div>
          <button className="salary-modal-close" onClick={onClose}><i className="ri-close-line" /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="salary-field">
            <label className="salary-field-label">EMP Code (e.g. STS001) <span className="salary-required">*</span></label>
            <input className="salary-input" value={empCode} onChange={e => setEmpCode(e.target.value)} required disabled={isEditing} />
          </div>
          <div className="salary-field">
            <label className="salary-field-label">Name <span className="salary-required">*</span></label>
            <input className="salary-input" value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <div className="salary-field">
            <label className="salary-field-label">Email <span className="salary-required">*</span></label>
            <input className="salary-input" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
          </div>
          <div className="salary-field">
            <label className="salary-field-label">Department <span className="salary-required">*</span></label>
            <select className="salary-input" value={department} onChange={e => setDepartment(e.target.value)} required disabled={isEditing && user?.role === 'admin'}>
              <option value="">-- Select Department --</option>
              <option value="Development">Development</option>
              <option value="Design">Design</option>
              <option value="Operations">Operations</option>
              <option value="Sales">Sales</option>
            </select>
          </div>
          <div className="salary-field">
            <label className="salary-field-label">Designation <span className="salary-required">*</span></label>
            <input className="salary-input" value={designation} onChange={e => setDesignation(e.target.value)} required />
          </div>
          <div className="salary-field">
            <label className="salary-field-label">Date of Joining <span className="salary-required">*</span></label>
            <input className="salary-input" type="date" value={dateOfJoining} onChange={e => setDateOfJoining(e.target.value)} required />
          </div>
          <div className="salary-field">
            <label className="salary-field-label">Role <span className="salary-required">*</span></label>
            <select className="salary-input" value={role} onChange={e => setRole(e.target.value)} required>
              <option value="employee">Employee</option>
              <option value="admin">Admin</option>
              <option value="manager">Manager</option>
              <option value="head">Head</option>
              <option value="superadmin">Super Admin</option>
            </select>
          </div>

          {role === 'admin' && (
            <div className="salary-field">
              <label className="salary-field-label">Managed Department (For Admin) <span className="salary-required">*</span></label>
              <select className="salary-input" value={managedDepartment} onChange={e => setManagedDepartment(e.target.value)} required>
                <option value="">-- Select Department --</option>
                <option value="Development">Development</option>
                <option value="Design">Design</option>
                <option value="Operations">Operations</option>
                <option value="Sales">Sales</option>
              </select>
            </div>
          )}

          {role === 'manager' && (
            <div className="salary-field">
              <label className="salary-field-label">Managed Departments (For Manager) <span className="salary-required">*</span></label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
                {['Development', 'Design', 'Operations', 'Sales'].map(d => {
                  const depts = managedDepartment ? managedDepartment.split(',').map(x => x.trim()) : [];
                  const isChecked = depts.includes(d);
                  return (
                    <label key={d} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
                      <input 
                        type="checkbox" 
                        checked={isChecked}
                        onChange={(e) => {
                          let newDepts = [...depts];
                          if (e.target.checked) newDepts.push(d);
                          else newDepts = newDepts.filter(x => x !== d);
                          setManagedDepartment(newDepts.join(', '));
                        }} 
                      />
                      {d}
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {user?.role === 'superadmin' && (
            <div className="salary-field">
              <label className="salary-field-label">Reports To (Optional)</label>
              <select className="salary-input" value={reportsTo} onChange={e => setReportsTo(e.target.value)}>
                <option value="">-- No Direct Manager --</option>
                {potentialManagers.filter(pm => pm.id !== initialData?.id).map(pm => (
                  <option key={pm.id} value={pm.id}>{pm.name} ({pm.role})</option>
                ))}
              </select>
            </div>
          )}

          <div className="salary-field">
            <label className="salary-field-label">Status <span className="salary-required">*</span></label>
            <select className="salary-input" value={status} onChange={e => setStatus(e.target.value)} required>
              <option value="Active">Active</option>
              <option value="On Notice">On Notice</option>
              <option value="Released">Released</option>
            </select>
          </div>
          <div className="salary-modal-actions">
            <button type="button" className="salary-cancel-btn" onClick={onClose} disabled={isSubmitting}>Cancel</button>
            <button type="submit" className="salary-submit-btn" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : (isEditing ? 'Save Changes' : 'Add Employee')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

/* ─── Main Employees Page ─────────────────────────────── */
const Employees = () => {
  const { user } = useContext(AuthContext);
  const [employees, setEmployees] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [viewingEmployee, setViewingEmployee] = useState(null); // for detail popup
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'employee') return <Navigate to="/" replace />;

  const fetchEmployees = async () => {
    setLoading(true);
    let query = supabase.from('employees').select('*').order('created_at', { ascending: false });
    
    if (user.role === 'admin' || user.role === 'manager') {
      const allowedDepts = getManagedDepartments(user);
      if (allowedDepts.length > 0) {
        query = query.or(`department.in.(${allowedDepts.join(',')}),reports_to.eq.${user.id}`);
      } else {
        query = query.eq('reports_to', user.id);
      }
    }
    
    const { data, error } = await query;
    if (error) console.error('Error fetching employees:', error);
    else setEmployees(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchEmployees(); }, [user]);

  const handleSaveEmployee = async (employeeData) => {
    const { id, email, ...rest } = employeeData;
    const cleanEmail = email.toLowerCase().trim();
    const dataToSave = { ...rest, email: cleanEmail };
    if (id) {
      const { error } = await supabase.from('employees').update(dataToSave).eq('id', id);
      if (error) alert('Error updating employee: ' + error.message);
      else { fetchEmployees(); setShowModal(false); setEditingEmployee(null); }
    } else {
      const { data: newEmployee, error } = await supabase.from('employees').insert([dataToSave]).select();
      if (error) alert('Error adding employee: ' + error.message);
      else {
        if (newEmployee && newEmployee.length > 0) {
          const empId = newEmployee[0].id;
          await supabase.from('leave_balances').insert([{ employee_id: empId, sick_leave: 12, casual_leave: 12, comp_off: 0 }]);
        }
        fetchEmployees();
        setShowModal(false);
      }
    }
  };

  const handleDelete = async (id) => {
    if (window.confirm('Are you sure you want to delete this employee? This action cannot be undone.')) {
      const { error } = await supabase.from('employees').delete().eq('id', id);
      if (error) alert('Error deleting employee: ' + error.message);
      else fetchEmployees();
    }
  };

  const openEditModal = (emp) => { setEditingEmployee(emp); setShowModal(true); };

  const generateNextEmpCode = () => {
    if (!employees || employees.length === 0) return 'STS001';
    const codes = employees
      .map(emp => emp.emp_code)
      .filter(code => code && typeof code === 'string')
      .map(code => { const match = code.match(/[a-zA-Z]+(\d+)/); return match ? parseInt(match[1], 10) : NaN; })
      .filter(num => !isNaN(num));
    if (codes.length === 0) return 'STS001';
    return `STS${String(Math.max(...codes) + 1).padStart(3, '0')}`;
  };

  const openAddModal = () => { setEditingEmployee({ emp_code: generateNextEmpCode() }); setShowModal(true); };

  const filteredEmployees = employees.filter(emp =>
    !search || emp.name?.toLowerCase().includes(search.toLowerCase()) ||
    emp.emp_code?.toLowerCase().includes(search.toLowerCase()) ||
    emp.department?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Layout title="Employees">
      <div className="card mb-6">
        <div className="flex justify-between items-center">
          <div className="input-group" style={{ margin: 0, flexDirection: 'row', alignItems: 'center', width: '300px', position: 'relative' }}>
            <i className="ri-search-line text-muted" style={{ position: 'absolute', left: '0.75rem' }}></i>
            <input
              type="text"
              placeholder="Search employees..."
              style={{ paddingLeft: '2.5rem', width: '100%' }}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          {user.role === 'superadmin' && (
            <button className="btn" onClick={openAddModal}><i className="ri-user-add-line"></i> Add Employee</button>
          )}
        </div>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Department</th>
              <th>Designation</th>
              <th>Status</th>
              {user.role === 'superadmin' && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="6" style={{ textAlign: 'center' }}>Loading employees...</td></tr>
            ) : filteredEmployees.length === 0 ? (
              <tr><td colSpan="6" style={{ textAlign: 'center' }}>No employees found.</td></tr>
            ) : (
              filteredEmployees.map((emp) => {
                const sc = statusColor(emp.status);
                return (
                  <tr
                    key={emp.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setViewingEmployee(emp)}
                  >
                    <td style={{ color: '#646465', fontSize: '0.85rem' }}>{emp.emp_code}</td>
                    <td>
                      <div className="flex items-center gap-3">
                        <EmpAvatar emp={emp} size={36} />
                        <div>
                          <div className="font-bold" style={{ color: '#000' }}>{emp.name}</div>
                          <div style={{ fontSize: '0.78rem', color: '#646465', textTransform: 'capitalize' }}>
                            {emp.role}{(emp.role === 'admin' || emp.role === 'manager') && emp.managed_department ? ` (${emp.managed_department})` : ''}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>{emp.department}</td>
                    <td>{emp.designation}</td>
                    <td>
                      <span style={{ ...sc, padding: '3px 12px', borderRadius: 20, fontSize: '0.78rem', fontWeight: 700 }}>
                        {emp.status || 'Active'}
                      </span>
                    </td>
                    {user.role === 'superadmin' && (
                      <td onClick={e => e.stopPropagation()}>
                        <div className="flex gap-2">
                          <button className="icon-btn" style={{ width: 32, height: 32 }} onClick={() => openEditModal(emp)}>
                            <i className="ri-pencil-line"></i>
                          </button>
                          <button className="icon-btn" style={{ width: 32, height: 32, color: 'var(--danger)' }} onClick={() => handleDelete(emp.id)}>
                            <i className="ri-delete-bin-line"></i>
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Employee Detail Popup */}
      {viewingEmployee && (
        <EmployeeDetailModal
          emp={viewingEmployee}
          onClose={() => setViewingEmployee(null)}
          onEdit={openEditModal}
          canEdit={user.role === 'superadmin'}
        />
      )}

      {/* Add / Edit Modal */}
      {showModal && (
        <EmployeeModal
          initialData={editingEmployee}
          user={user}
          onClose={() => { setShowModal(false); setEditingEmployee(null); }}
          onSave={handleSaveEmployee}
        />
      )}
    </Layout>
  );
};

export default Employees;
