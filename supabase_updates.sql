-- =============================================================
-- HRMS Supabase Updates Script
-- Run this in your Supabase SQL Editor
-- =============================================================

-- 1. Add missing columns to employees table
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS designation TEXT,
  ADD COLUMN IF NOT EXISTS date_of_joining DATE;

-- 2. Create daily_reports table (BOS / EOD)
CREATE TABLE IF NOT EXISTS daily_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  bos_report TEXT,
  bos_submitted_at TIMESTAMP WITH TIME ZONE,
  eod_report TEXT,
  eod_submitted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(employee_id, date)
);

-- Disable RLS on all tables for development
ALTER TABLE employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE attendance DISABLE ROW LEVEL SECURITY;
ALTER TABLE leaves DISABLE ROW LEVEL SECURITY;
ALTER TABLE inbox DISABLE ROW LEVEL SECURITY;
ALTER TABLE salary_configs DISABLE ROW LEVEL SECURITY;
ALTER TABLE salary_payments DISABLE ROW LEVEL SECURITY;
ALTER TABLE daily_reports DISABLE ROW LEVEL SECURITY;

-- =============================================================
-- 3. Insert Mock Employees (3 test users)
-- =============================================================
INSERT INTO employees (id, emp_code, name, email, department, designation, role, status, date_of_joining)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'STS001', 'Sarah Admin',   'admin@spatio.com',    'Management',  'Super Administrator', 'superadmin', 'Active', '2022-04-01'),
  ('22222222-2222-2222-2222-222222222222', 'STS002', 'John Manager',  'manager@spatio.com',  'Engineering', 'Engineering Manager',  'admin',      'Active', '2022-06-15'),
  ('33333333-3333-3333-3333-333333333333', 'STS003', 'Alice Johnson', 'employee@spatio.com', 'Engineering', 'Software Developer',   'employee',   'Active', '2023-01-10')
ON CONFLICT (email) DO UPDATE
  SET designation = EXCLUDED.designation,
      date_of_joining = EXCLUDED.date_of_joining;

-- =============================================================
-- 4. Insert Mock Attendance (for Alice, past 4 days)
-- =============================================================
INSERT INTO attendance (employee_id, date, check_in, check_out, status)
VALUES
  ('33333333-3333-3333-3333-333333333333', CURRENT_DATE - 3, '09:00', '18:00', 'Present'),
  ('33333333-3333-3333-3333-333333333333', CURRENT_DATE - 2, '09:15', '18:05', 'Late'),
  ('33333333-3333-3333-3333-333333333333', CURRENT_DATE - 1, NULL,    NULL,    'Absent'),
  ('22222222-2222-2222-2222-222222222222', CURRENT_DATE - 3, '09:00', '18:00', 'Present'),
  ('22222222-2222-2222-2222-222222222222', CURRENT_DATE - 2, '08:55', '17:50', 'Present'),
  ('11111111-1111-1111-1111-111111111111', CURRENT_DATE - 3, '09:00', '18:00', 'Present')
ON CONFLICT DO NOTHING;

-- =============================================================
-- 5. Insert Mock Leaves
-- =============================================================
INSERT INTO leaves (employee_id, type, from_date, to_date, days, status)
VALUES
  ('33333333-3333-3333-3333-333333333333', 'Sick Leave',    '2024-11-01', '2024-11-02', 2, 'Approved'),
  ('33333333-3333-3333-3333-333333333333', 'Annual Leave',  '2024-12-20', '2024-12-25', 6, 'Pending'),
  ('33333333-3333-3333-3333-333333333333', 'Casual Leave',  '2024-09-15', '2024-09-15', 1, 'Rejected'),
  ('22222222-2222-2222-2222-222222222222', 'Casual Leave',  '2024-11-01', '2024-11-01', 1, 'Pending')
ON CONFLICT DO NOTHING;

-- =============================================================
-- 6. Insert Mock Inbox Messages
-- =============================================================
INSERT INTO inbox (sender_id, receiver_id, subject, body, is_read)
VALUES
  (NULL,                                     '33333333-3333-3333-3333-333333333333', 'Diwali Bonus Announcement', 'Dear team, we are pleased to announce Diwali bonuses this year!', false),
  ('11111111-1111-1111-1111-111111111111',   '33333333-3333-3333-3333-333333333333', 'Project Updates',           'Please review the latest project updates and share your feedback.', true),
  (NULL,                                     '33333333-3333-3333-3333-333333333333', 'Leave Approved',            'Your leave request for Oct 20 has been approved.',                 true),
  ('11111111-1111-1111-1111-111111111111',   '22222222-2222-2222-2222-222222222222', 'Q4 Performance Review',     'Please complete your self-assessment for Q4 by end of this week.', false)
ON CONFLICT DO NOTHING;

-- =============================================================
-- 7. Insert Salary Configs
-- =============================================================
INSERT INTO salary_configs (employee_id, ctc, basic, hra, cca, conveyance, special_allowance, pf, esic, tds, professional_tax, loan_repayment)
VALUES
  ('11111111-1111-1111-1111-111111111111', 1620000, 60000, 30000, 5000, 4000, 21000, 7200, 0,    5000, 200, 0),
  ('22222222-2222-2222-2222-222222222222', 1080000, 40000, 20000, 3000, 3000, 14000, 4800, 0,    3000, 200, 0),
  ('33333333-3333-3333-3333-333333333333', 720000,  25000, 12000, 2000, 2000,  9000, 3000, 1200, 1500, 200, 0)
ON CONFLICT (employee_id) DO NOTHING;
