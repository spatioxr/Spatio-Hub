import React, { useContext, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AuthContext } from '../context/AuthContext';
import { supabase } from '../utils/supabaseClient';
import { isDepartmentManagedBy } from '../utils/rbac';
import { useNavigate } from 'react-router-dom';
import WorkTimerControl from './WorkTimerControl';
import { formatAppDate } from '../utils/timezone';

const TopBar = ({ title }) => {
  const { user, logout, updateUser } = useContext(AuthContext);
  const navigate = useNavigate();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const fileInputRef = useRef(null);
  const dropdownRef = useRef(null);

  const [localAvatar, setLocalAvatar] = useState(null);
  const [cropModal, setCropModal] = useState(null); // { objectUrl }
  const [saving, setSaving] = useState(false);
  const [reportsTo, setReportsTo] = useState('Loading...');

  useEffect(() => {
    if (user?.avatar_url) setLocalAvatar(user.avatar_url);
    
    // Fetch reports to
    if (user?.reports_to) {
      const fetchReportsTo = async () => {
        const { data } = await supabase.from('employees').select('name').eq('id', user.reports_to).maybeSingle();
        setReportsTo(data ? data.name : 'Unknown Manager');
      };
      fetchReportsTo();
    } else if (user?.role === 'superadmin') {
      setReportsTo('N/A (Superadmin)');
    } else if (user?.role === 'head') {
      setReportsTo('Super Admin');
    } else if (user?.role === 'admin' || user?.role === 'manager') {
      const fetchHead = async () => {
        const { data } = await supabase.from('employees').select('name').eq('role', 'head').limit(1).maybeSingle();
        setReportsTo(data ? data.name : 'Head (Unassigned)');
      };
      fetchHead();
    } else if (user?.department) {
      const fetchAdmin = async () => {
        const { data } = await supabase
          .from('employees')
          .select('name, role, managed_department')
          .in('role', ['admin', 'manager']);
          
        if (data && data.length > 0) {
          const manager = data.find(m => isDepartmentManagedBy(user.department, m));
          setReportsTo(manager ? manager.name : 'No Admin Assigned');
        } else {
          setReportsTo('No Admin Assigned');
        }
      };
      fetchAdmin();
    }
  }, [user]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleFileSelect = (e) => {
    try {
      const file = e.target.files[0];
      if (!file) return;
      const objectUrl = URL.createObjectURL(file);
      setCropModal({ objectUrl });
      setDropdownOpen(false);
    } catch (err) {
      alert("Error processing file: " + err.message);
    } finally {
      // reset input so same file can be selected again
      e.target.value = '';
    }
  };

  const handleCropSave = async (objectUrl) => {
    setSaving(true);
    const img = new Image();
    img.onload = async () => {
      const SIZE = 240;
      const canvas = document.createElement('canvas');
      // Crop to a centered square
      const min = Math.min(img.width, img.height);
      const sx = (img.width - min) / 2;
      const sy = (img.height - min) / 2;
      canvas.width = SIZE;
      canvas.height = SIZE;
      canvas.getContext('2d').drawImage(img, sx, sy, min, min, 0, 0, SIZE, SIZE);
      const base64Str = canvas.toDataURL('image/jpeg', 0.75);
      URL.revokeObjectURL(objectUrl);

      setLocalAvatar(base64Str);
      const { error } = await supabase.from('employees').update({ avatar_url: base64Str }).eq('id', user.id);
      if (!error) {
        updateUser({ avatar_url: base64Str });
      } else {
        console.error('Avatar save failed:', error.message);
        alert('Failed to save profile picture! Error: ' + error.message);
      }
      setCropModal(null);
      setSaving(false);
    };
    img.src = objectUrl;
  };

  return (
    <header className="topbar">
      <div className="topbar-brand">
        <span className="topbar-brand-mark" aria-hidden="true">S</span>
        <h1 className="page-title">{title}</h1>
      </div>
      <div className="topbar-actions">
        <WorkTimerControl />
        <div className="user-profile" ref={dropdownRef} onClick={() => setDropdownOpen(!dropdownOpen)}>
          <div className="avatar user-profile-avatar">
            {localAvatar ? (
              <img src={localAvatar} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              user?.name?.charAt(0)
            )}
          </div>
          <div className="flex-col">
            <span className="font-bold text-sm" style={{ color: 'var(--text-main)' }}>{user?.name}</span>
            <span className="text-xs text-muted" style={{ textTransform: 'capitalize' }}>{user?.role}</span>
          </div>
          <i className="ri-arrow-down-s-line text-muted ml-2"></i>

          {dropdownOpen && (
            <div className="profile-menu" onClick={e => e.stopPropagation()}>
              
              {/* Profile Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div style={{ position: 'relative' }}>
                  <div className="avatar" style={{ overflow: 'hidden', width: '60px', height: '60px', fontSize: '1.5rem', background: '#F1F5F9', color: '#64748B' }}>
                    {localAvatar ? (
                      <img src={localAvatar} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      user?.name?.charAt(0)
                    )}
                  </div>
                  <button 
                    onClick={(e) => { e.stopPropagation(); fileInputRef.current.click(); }}
                    style={{ position: 'absolute', bottom: -5, right: -5, background: '#4318FF', color: 'white', border: '2px solid white', borderRadius: '50%', width: 28, height: 28, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 5px rgba(0,0,0,0.2)' }}
                    title="Change Picture"
                  >
                    <i className="ri-pencil-fill" style={{ fontSize: '0.8rem' }}></i>
                  </button>
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-main)', fontWeight: 'bold' }}>{user?.name}</h3>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748B', textTransform: 'capitalize' }}>{user?.role}</p>
                </div>
              </div>

              <div style={{ height: 1, background: '#F1F5F9' }} />

              {/* Details */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.9rem', color: 'var(--text-main)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748B' }}>Department</span>
                  <span style={{ fontWeight: 500 }}>{user?.department || 'N/A'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748B' }}>Designation</span>
                  <span style={{ fontWeight: 500 }}>{user?.designation || 'N/A'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748B' }}>Date of Joining</span>
                  <span style={{ fontWeight: 500 }}>{user?.date_of_joining ? formatAppDate(user.date_of_joining) : 'N/A'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748B' }}>Reports to</span>
                  <span style={{ fontWeight: 500 }}>{reportsTo}</span>
                </div>
              </div>

              <div style={{ height: 1, background: '#F1F5F9' }} />

              {/* Action Buttons */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <div
                  style={{ padding: '0.5rem 0.75rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-main)', transition: 'background 0.2s', borderRadius: '6px' }}
                  onMouseOver={(e) => e.currentTarget.style.background = 'rgba(0,0,0,0.03)'}
                  onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
                  onClick={() => { setDropdownOpen(false); navigate('/reset-password'); }}
                >
                  <i className="ri-lock-password-line"></i> Reset Password
                </div>
                <div
                  style={{ padding: '0.5rem 0.75rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--danger)', transition: 'background 0.2s', borderRadius: '6px' }}
                  onMouseOver={(e) => e.currentTarget.style.background = 'rgba(238,93,80,0.05)'}
                  onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
                  onClick={async () => {
                    setDropdownOpen(false);
                    await logout();
                    navigate('/login');
                  }}
                >
                  <i className="ri-logout-box-r-line"></i> Logout
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <input
        type="file"
        accept="image/*"
        ref={fileInputRef}
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />

      {/* Crop Preview Modal */}
      {cropModal && createPortal(
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999999
          }}
          onClick={(e) => { if (e.target === e.currentTarget) { URL.revokeObjectURL(cropModal.objectUrl); setCropModal(null); } }}
        >
          <div style={{ background: 'white', borderRadius: 16, padding: '2rem', maxWidth: 380, width: '90%', textAlign: 'center' }}>
            <h3 style={{ fontWeight: 700, color: '#1E293B', marginBottom: '0.5rem' }}>Preview Profile Picture</h3>
            <p style={{ color: '#64748B', fontSize: '0.85rem', marginBottom: '1.5rem' }}>The image will be cropped to a circle. Looks good?</p>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.5rem' }}>
              <img
                src={cropModal.objectUrl}
                alt="Preview"
                style={{ width: 160, height: 160, borderRadius: '50%', objectFit: 'cover', border: '4px solid #E2E8F0', boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}
              />
            </div>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
              <button
                style={{ padding: '0.6rem 1.25rem', borderRadius: 8, border: '1px solid #CBD5E1', background: 'white', cursor: 'pointer', color: '#64748B', fontWeight: 600 }}
                onClick={() => { URL.revokeObjectURL(cropModal.objectUrl); setCropModal(null); }}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                style={{ padding: '0.6rem 1.25rem', borderRadius: 8, border: 'none', background: '#4318FF', cursor: 'pointer', color: 'white', fontWeight: 600 }}
                onClick={() => handleCropSave(cropModal.objectUrl)}
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Set as Profile Picture'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </header>
  );
};

export default TopBar;
