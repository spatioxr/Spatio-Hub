import React, { useContext, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AuthContext } from '../context/AuthContext';
import { supabase } from '../utils/supabaseClient';
import { isDepartmentManagedBy } from '../utils/rbac';
import { useNavigate } from 'react-router-dom';
import WorkTimerControl from './WorkTimerControl';
import { formatAppDate } from '../utils/timezone';
import {
  cacheableAvatarUrl,
  canvasToJpegBlob,
  createSignedAvatarUrl,
  isEmbeddedAvatar,
  migrateEmbeddedEmployeeAvatar,
  storeEmployeeAvatar,
} from '../utils/avatars';

const TopBar = ({
  title,
  showTimer = true,
  showLiveStatusToggle = false,
  liveStatusOpen = false,
  onLiveStatusToggle,
}) => {
  const { user, logout, updateUser } = useContext(AuthContext);
  const navigate = useNavigate();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const fileInputRef = useRef(null);
  const dropdownRef = useRef(null);
  const profileButtonRef = useRef(null);

  const [localAvatar, setLocalAvatar] = useState(null);
  const [cropModal, setCropModal] = useState(null); // { objectUrl }
  const [saving, setSaving] = useState(false);
  const [reportsTo, setReportsTo] = useState('Loading...');

  useEffect(() => {
    let active = true;

    const loadAvatar = async () => {
      if (user?.avatar_path) {
        try {
          const signedUrl = await createSignedAvatarUrl(supabase, user.avatar_path);
          if (active) setLocalAvatar(signedUrl);
        } catch (error) {
          console.warn('Unable to load the stored profile picture:', error.message);
          if (active) setLocalAvatar(cacheableAvatarUrl(user.avatar_url));
        }
        return;
      }

      if (isEmbeddedAvatar(user?.avatar_url)) {
        setLocalAvatar(user.avatar_url);
        try {
          const migrated = await migrateEmbeddedEmployeeAvatar({
            client: supabase,
            employeeId: user.id,
            embeddedAvatar: user.avatar_url,
          });
          if (active && migrated) {
            setLocalAvatar(migrated.signedUrl);
            updateUser({ avatar_path: migrated.path, avatar_url: null });
          }
        } catch (error) {
          console.warn('Unable to migrate the legacy profile picture:', error.message);
        }
        return;
      }

      setLocalAvatar(cacheableAvatarUrl(user?.avatar_url));
    };

    if (user?.id) void loadAvatar();
    else setLocalAvatar(null);

    return () => {
      active = false;
    };
  }, [updateUser, user?.avatar_path, user?.avatar_url, user?.id]);

  useEffect(() => {
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
      try {
        const SIZE = 240;
        const canvas = document.createElement('canvas');
        // Crop to a centered square.
        const min = Math.min(img.width, img.height);
        const sx = (img.width - min) / 2;
        const sy = (img.height - min) / 2;
        canvas.width = SIZE;
        canvas.height = SIZE;
        canvas.getContext('2d').drawImage(img, sx, sy, min, min, 0, 0, SIZE, SIZE);
        const jpeg = await canvasToJpegBlob(canvas);
        const stored = await storeEmployeeAvatar({
          client: supabase,
          employeeId: user.id,
          image: jpeg,
          previousPath: user.avatar_path,
        });

        setLocalAvatar(stored.signedUrl);
        updateUser({ avatar_path: stored.path, avatar_url: null });
      } catch (error) {
        console.error('Avatar save failed:', error.message);
        alert(`Failed to save profile picture! Error: ${error.message}`);
      } finally {
        URL.revokeObjectURL(objectUrl);
        setCropModal(null);
        setSaving(false);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      setCropModal(null);
      setSaving(false);
      alert('Unable to read that image. Please choose another file.');
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
        {showTimer && <WorkTimerControl />}
        {showLiveStatusToggle && (
          <button
            type="button"
            className="topbar-live-status-toggle"
            onClick={onLiveStatusToggle}
            aria-label={`${liveStatusOpen ? 'Close' : 'Open'} who’s in/out`}
            aria-expanded={liveStatusOpen}
            aria-controls="management-live-status"
          >
            <i className="ri-user-location-line" aria-hidden="true" />
            <span>Who’s in/out</span>
          </button>
        )}
        <div
          className="user-profile-wrapper"
          ref={dropdownRef}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && dropdownOpen) {
              event.preventDefault();
              setDropdownOpen(false);
              profileButtonRef.current?.focus();
            }
          }}
        >
          <button
            ref={profileButtonRef}
            type="button"
            className="user-profile"
            onClick={() => setDropdownOpen((current) => !current)}
            aria-expanded={dropdownOpen}
            aria-haspopup="menu"
            aria-controls="profile-menu"
            aria-label={`Open profile menu for ${user?.name || 'current user'}`}
          >
            <span className="avatar user-profile-avatar">
              {localAvatar ? (
                <img src={localAvatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                user?.name?.charAt(0)
              )}
            </span>
            <span className="flex-col">
              <span className="font-bold text-sm" style={{ color: 'var(--text-main)' }}>{user?.name}</span>
              <span className="text-xs text-muted" style={{ textTransform: 'capitalize' }}>{user?.role}</span>
            </span>
            <i className="ri-arrow-down-s-line text-muted ml-2" aria-hidden="true"></i>
          </button>

          {dropdownOpen && (
            <div className="profile-menu" id="profile-menu" role="menu">
              
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
                    type="button"
                    onClick={(e) => { e.stopPropagation(); fileInputRef.current.click(); }}
                    style={{ position: 'absolute', bottom: -5, right: -5, background: '#4318FF', color: 'white', border: '2px solid white', borderRadius: '50%', width: 28, height: 28, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 5px rgba(0,0,0,0.2)' }}
                    title="Change Picture"
                    aria-label="Change profile picture"
                  >
                    <i className="ri-pencil-fill" style={{ fontSize: '0.8rem' }} aria-hidden="true"></i>
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
                <button
                  type="button"
                  className="profile-menu-action"
                  role="menuitem"
                  onClick={() => { setDropdownOpen(false); navigate('/reset-password'); }}
                >
                  <i className="ri-lock-password-line" aria-hidden="true"></i> Reset Password
                </button>
                <button
                  type="button"
                  className="profile-menu-action profile-menu-action--danger"
                  role="menuitem"
                  onClick={async () => {
                    setDropdownOpen(false);
                    await logout();
                    navigate('/login');
                  }}
                >
                  <i className="ri-logout-box-r-line" aria-hidden="true"></i> Logout
                </button>
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
