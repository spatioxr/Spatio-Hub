import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import Layout from '../components/Layout';
import AppState from '../components/AppState';
import { AuthContext } from '../context/AuthContext';
import { WorkSessionContext } from '../context/WorkSessionContext';
import { supabase } from '../utils/supabaseClient';
import {
  getRole,
  hasPermission,
  PERMISSIONS,
  ROLES,
} from '../utils/rbac';
import {
  appDateKey,
  appDateTimeInputToIso,
  appDayRange,
  formatAppClock,
  formatAppDate,
  formatAppDateTime,
  toAppDateTimeInput,
} from '../utils/timezone';
import useDialogFocus from '../hooks/useDialogFocus';
import ContextNavigator from '../components/ContextNavigator';
import { getSequenceNavigation } from '../utils/sequenceNavigation';
import {
  ATTENDANCE_DAY_STATES,
  resolveAttendanceDayState,
} from '../utils/attendance';
import {
  dateKeysInRange,
  monthBounds,
  nextManualEntryRange,
  suggestedBreakRange,
  summarizeEmployeesForMonth,
  summarizeTimesheetDays,
} from '../utils/timesheet';
import { isActiveScopeMember } from '../utils/people';

const SCOPE_COPY = {
  personal: {
    label: 'Personal',
    eyebrow: 'Personal',
    heading: 'My timesheet',
    description: 'A focused view of your tracked work, breaks, and daily context.',
  },
  managed: {
    label: 'Managed by me',
    eyebrow: 'Project teams',
    heading: 'Team timesheets',
    description: 'Work entries for people assigned to projects you manage.',
  },
  organisation: {
    label: 'Organisation',
    eyebrow: 'Organisation',
    heading: 'Organisation timesheets',
    description: 'Company-wide totals with a clear path to each person.',
  },
};

const startOfWeek = (date) => {
  const start = new Date(`${appDateKey(date)}T12:00:00Z`);
  const mondayOffset = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - mondayOffset);
  return start;
};

const addDays = (date, days) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const dateKey = appDateKey;

const formatDuration = (seconds) => {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
};

const formatClock = formatAppClock;
const formatDateTime = formatAppDateTime;
const formatWorkMode = (workMode) => {
  if (workMode === 'wfh') return 'WFH';
  if (workMode === 'office') return 'Office';
  return 'Not recorded';
};

const formatAuditBreaks = (breaks) => {
  if (!Array.isArray(breaks) || breaks.length === 0) return 'No breaks';
  return breaks.map((breakEntry) => (
    `${formatClock(breakEntry.started_at)} – ${formatClock(breakEntry.ended_at)}`
  )).join(', ');
};

const AUDIT_FIELDS = [
  {
    key: 'status',
    label: 'Entry status',
    value: (record) => record?.voided_at ? 'Voided' : 'Active',
  },
  {
    key: 'work-mode',
    label: 'Work mode',
    value: (record) => formatWorkMode(record?.work_mode),
  },
  {
    key: 'context',
    label: 'Project or activity',
    value: (record) => record?.context_label || 'Not recorded',
  },
  {
    key: 'task',
    label: 'Task description',
    value: (record) => record?.task_description || 'Not recorded',
  },
  {
    key: 'start',
    label: 'Start',
    value: (record) => formatDateTime(record?.started_at),
  },
  {
    key: 'end',
    label: 'End',
    value: (record) => formatDateTime(record?.ended_at),
  },
  {
    key: 'breaks',
    label: 'Breaks',
    value: (record) => formatAuditBreaks(record?.breaks),
  },
];

const getAuditChanges = (historyItem) => AUDIT_FIELDS
  .map((field) => ({
    ...field,
    before: historyItem.change_kind === 'created'
      ? 'No existing entry'
      : field.value(historyItem.old_record),
    after: field.value(historyItem.new_record),
  }))
  .filter((field) => (
    historyItem.change_kind === 'created' || field.before !== field.after
  ));

const formatWeekRange = (weekStart) => {
  const weekEnd = addDays(weekStart, 6);
  const sameMonth = weekStart.getUTCMonth() === weekEnd.getUTCMonth();
  const start = formatAppDate(weekStart, {
    day: 'numeric',
    ...(sameMonth ? {} : { month: 'short' }),
    year: undefined,
  });
  const end = formatAppDate(weekEnd, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return `${start} – ${end}`;
};

const formatMonthTitle = (date) => formatAppDate(date, {
  day: undefined,
  month: 'long',
  year: 'numeric',
});

const MONTH_DAY_STATE_COPY = {
  [ATTENDANCE_DAY_STATES.NOT_APPLICABLE]: 'Before joining',
  [ATTENDANCE_DAY_STATES.FUTURE]: 'Future',
  [ATTENDANCE_DAY_STATES.HOLIDAY]: 'Holiday',
  [ATTENDANCE_DAY_STATES.WEEKEND]: 'Weekend',
  [ATTENDANCE_DAY_STATES.LEAVE]: 'Leave',
  [ATTENDANCE_DAY_STATES.HALF_LEAVE_WORKED]: 'Half leave',
  [ATTENDANCE_DAY_STATES.WORKING]: 'Open entry',
  [ATTENDANCE_DAY_STATES.COMPLETED]: 'Recorded',
  [ATTENDANCE_DAY_STATES.NO_RECORD]: 'No time',
};

const sortByLabel = (options) => (
  [...options].sort((left, right) => left.label.localeCompare(right.label))
);

const toLocalDateTimeInput = toAppDateTimeInput;

const defaultManualForm = (selectedDate) => ({
  context: '',
  workMode: 'office',
  taskDescription: '',
  startedAt: `${selectedDate}T09:00`,
  endedAt: `${selectedDate}T10:00`,
  breaks: [],
  reason: '',
});

const Timesheets = () => {
  const { user } = useContext(AuthContext);
  const { status: workStatus } = useContext(WorkSessionContext);
  const userRole = getRole(user);
  const availableScopes = useMemo(() => {
    const scopes = ['personal'];
    if (hasPermission(user, PERMISSIONS.VIEW_ASSIGNED_TEAM_TIMESHEETS)) {
      scopes.push('managed');
    }
    if (hasPermission(user, PERMISSIONS.VIEW_ORGANISATION_TIMESHEETS)) {
      return ['personal', 'organisation'];
    }
    return scopes;
  }, [user]);
  const [scope, setScope] = useState('personal');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('all');
  const [selectedDepartment, setSelectedDepartment] = useState('all');
  const [selectedProjectId, setSelectedProjectId] = useState('all');
  const [selectedActivityId, setSelectedActivityId] = useState('all');
  const [viewMode, setViewMode] = useState('week');
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => dateKey(new Date()));
  const [entries, setEntries] = useState([]);
  const [voidedEntries, setVoidedEntries] = useState([]);
  const [members, setMembers] = useState([]);
  const [filterProjects, setFilterProjects] = useState([]);
  const [filterActivities, setFilterActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [manualEditor, setManualEditor] = useState(null);
  const [manualContexts, setManualContexts] = useState([]);
  const [manualForm, setManualForm] = useState(() => defaultManualForm(dateKey(new Date())));
  const [manualError, setManualError] = useState('');
  const [manualSaving, setManualSaving] = useState(false);
  const [manualContextsLoading, setManualContextsLoading] = useState(false);
  const [historyViewer, setHistoryViewer] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [monthAttendance, setMonthAttendance] = useState([]);
  const [monthAttendanceLoading, setMonthAttendanceLoading] = useState(false);
  const [voidEditor, setVoidEditor] = useState(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidError, setVoidError] = useState('');
  const [voidSaving, setVoidSaving] = useState(false);

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    [weekStart],
  );

  const currentMonth = useMemo(() => monthBounds(selectedDate), [selectedDate]);
  const periodBounds = viewMode === 'month'
    ? { start: currentMonth.start, end: currentMonth.end }
    : { start: dateKey(weekStart), end: dateKey(addDays(weekStart, 6)) };
  const periodDateKeys = useMemo(
    () => dateKeysInRange(periodBounds.start, periodBounds.end),
    [periodBounds.end, periodBounds.start],
  );

  const loadTimesheet = useCallback(async () => {
    setLoading(true);
    setError('');

    const range = appDayRange(periodBounds.start, periodBounds.end);
    const [
      { data: entryData, error: entryError },
      { data: voidedEntryData, error: voidedEntryError },
      { data: memberData, error: memberError },
      { data: projectData, error: projectError },
      { data: activityData, error: activityError },
      { data: workModeData, error: workModeError },
    ] = await Promise.all([
      supabase.rpc('scoped_timesheet_entries', {
        requested_start_at: range.start,
        requested_end_at: range.end,
        requested_scope: scope,
        requested_employee_id: null,
      }),
      supabase.rpc('scoped_voided_timesheet_entries', {
        requested_start_at: range.start,
        requested_end_at: range.end,
        requested_scope: scope,
        requested_employee_id: null,
      }),
      supabase.rpc('timesheet_scope_members', {
        requested_scope: scope,
      }),
      supabase
        .from('projects')
        .select('id, code, name')
        .order('name', { ascending: true }),
      supabase
        .from('activities')
        .select('id, name')
        .order('name', { ascending: true }),
      supabase.rpc('scoped_attendance_work_modes', {
        requested_start_date: periodBounds.start,
        requested_end_date: dateKey(addDays(new Date(`${periodBounds.end}T12:00:00Z`), 1)),
        requested_scope: scope,
        requested_employee_id: null,
      }),
    ]);

    const fetchError = entryError
      || voidedEntryError
      || memberError
      || projectError
      || activityError
      || workModeError;
    if (fetchError) {
      setError(fetchError.message || 'Unable to load your timesheet.');
    } else {
      const activeMembers = (memberData || []).filter(isActiveScopeMember);
      const activeMemberIds = new Set(activeMembers.map((member) => member.employee_id));
      const workModeByEmployeeDay = new Map((workModeData || []).map((record) => [
        `${record.employee_id}:${record.attendance_date}`,
        record.work_mode,
      ]));
      setEntries((entryData || [])
        .filter((entry) => activeMemberIds.has(entry.employee_id))
        .map((entry) => ({
          ...entry,
          work_mode: workModeByEmployeeDay.get(
            `${entry.employee_id}:${dateKey(entry.started_at)}`,
          ) || null,
        })));
      setVoidedEntries((voidedEntryData || []).filter(
        (entry) => activeMemberIds.has(entry.employee_id),
      ));
      setMembers(activeMembers);
      setFilterProjects(projectData || []);
      setFilterActivities(activityData || []);
    }
    setLoading(false);
    return { error: fetchError || null };
  }, [periodBounds.end, periodBounds.start, scope]);

  useEffect(() => {
    void loadTimesheet();
  }, [loadTimesheet, workStatus]);

  const monthEmployeeId = scope === 'personal'
    ? user?.id
    : selectedEmployeeId === 'all' ? null : selectedEmployeeId;

  useEffect(() => {
    let active = true;
    if (viewMode !== 'month' || !monthEmployeeId) {
      setMonthAttendance([]);
      setMonthAttendanceLoading(false);
      return undefined;
    }

    const loadMonthAttendance = async () => {
      setMonthAttendanceLoading(true);
      const { data, error: attendanceError } = await supabase.rpc(
        'scoped_attendance_month',
        {
          requested_start_date: currentMonth.start,
          requested_end_date: dateKey(addDays(new Date(`${currentMonth.end}T12:00:00Z`), 1)),
          requested_scope: scope,
          requested_employee_id: monthEmployeeId,
        },
      );
      if (!active) return;
      setMonthAttendance(attendanceError ? [] : data || []);
      if (attendanceError) {
        setNotice({
          type: 'error',
          text: attendanceError.message || 'The attendance context for this month could not be loaded.',
        });
      }
      setMonthAttendanceLoading(false);
    };

    void loadMonthAttendance();
    return () => { active = false; };
  }, [currentMonth.end, currentMonth.start, monthEmployeeId, scope, viewMode]);

  const orderedMembers = useMemo(() => (
    [...members].sort((left, right) => (
      (left.employee_name || '').localeCompare(right.employee_name || '')
      || (left.employee_code || '').localeCompare(right.employee_code || '')
    ))
  ), [members]);

  const employeeOptions = useMemo(() => orderedMembers.map((member) => ({
    value: member.employee_id,
    label: `${member.employee_name} (${member.employee_code})`,
  })), [orderedMembers]);

  const departmentOptions = useMemo(() => sortByLabel(
    Array.from(new Set(
      members.map((member) => member.employee_department).filter(Boolean),
    )).map((department) => ({ value: department, label: department })),
  ), [members]);

  const projectOptions = useMemo(() => sortByLabel(
    Array.from(new Map(
      [
        ...filterProjects.map((project) => [
          project.id,
          { value: project.id, label: `${project.code} · ${project.name}` },
        ]),
        ...entries
          .filter((entry) => entry.context_type === 'project')
          .map((entry) => [
            entry.context_id,
            { value: entry.context_id, label: entry.context_label },
          ]),
      ],
    ).values()),
  ), [entries, filterProjects]);

  const activityOptions = useMemo(() => sortByLabel(
    Array.from(new Map(
      [
        ...filterActivities.map((activity) => [
          activity.id,
          { value: activity.id, label: activity.name },
        ]),
        ...entries
          .filter((entry) => entry.context_type === 'activity')
          .map((entry) => [
            entry.context_id,
            { value: entry.context_id, label: entry.context_label },
          ]),
      ],
    ).values()),
  ), [entries, filterActivities]);

  const selectedMember = members.find(
    (member) => member.employee_id === selectedEmployeeId,
  );

  const navigableMembers = useMemo(() => (
    orderedMembers.filter((member) => (
      selectedDepartment === 'all'
      || member.employee_department === selectedDepartment
    ))
  ), [orderedMembers, selectedDepartment]);

  const employeeNavigation = useMemo(() => (
    getSequenceNavigation(
      navigableMembers,
      selectedEmployeeId,
      (member) => member.employee_id,
    )
  ), [navigableMembers, selectedEmployeeId]);

  const previousEmployee = employeeNavigation.current
    ? employeeNavigation.previous
    : navigableMembers[navigableMembers.length - 1] || null;
  const nextEmployee = employeeNavigation.current
    ? employeeNavigation.next
    : navigableMembers[0] || null;

  const activeFilters = useMemo(() => {
    const filters = [];
    if (selectedEmployeeId !== 'all') {
      filters.push({
        key: 'employee',
        label: 'Employee',
        value: selectedMember
          ? `${selectedMember.employee_name} (${selectedMember.employee_code})`
          : 'Selected employee',
      });
    }
    if (selectedDepartment !== 'all') {
      filters.push({ key: 'department', label: 'Department', value: selectedDepartment });
    }
    if (selectedProjectId !== 'all') {
      filters.push({
        key: 'project',
        label: 'Project',
        value: projectOptions.find((option) => option.value === selectedProjectId)?.label
          || 'Selected project',
      });
    }
    if (selectedActivityId !== 'all') {
      filters.push({
        key: 'activity',
        label: 'Activity',
        value: activityOptions.find((option) => option.value === selectedActivityId)?.label
          || 'Selected activity',
      });
    }
    return filters;
  }, [
    activityOptions,
    projectOptions,
    selectedActivityId,
    selectedDepartment,
    selectedEmployeeId,
    selectedMember,
    selectedProjectId,
  ]);

  const filteredEntries = useMemo(() => entries.filter((entry) => {
    const employeeMatches = selectedEmployeeId === 'all'
      || entry.employee_id === selectedEmployeeId;
    const departmentMatches = selectedDepartment === 'all'
      || entry.employee_department === selectedDepartment;
    const projectFilterActive = selectedProjectId !== 'all';
    const activityFilterActive = selectedActivityId !== 'all';
    const contextMatches = !projectFilterActive && !activityFilterActive
      ? true
      : (
        (projectFilterActive
          && entry.context_type === 'project'
          && entry.context_id === selectedProjectId)
        || (activityFilterActive
          && entry.context_type === 'activity'
          && entry.context_id === selectedActivityId)
      );

    return employeeMatches && departmentMatches && contextMatches;
  }), [
    entries,
    selectedActivityId,
    selectedDepartment,
    selectedEmployeeId,
    selectedProjectId,
  ]);

  const entriesByDay = useMemo(() => {
    const grouped = Object.fromEntries(periodDateKeys.map((day) => [day, []]));
    filteredEntries.forEach((entry) => {
      const key = dateKey(entry.started_at);
      if (grouped[key]) grouped[key].push(entry);
    });
    return grouped;
  }, [filteredEntries, periodDateKeys]);

  const daySummaries = useMemo(
    () => summarizeTimesheetDays(filteredEntries, periodDateKeys),
    [filteredEntries, periodDateKeys],
  );

  const periodSummary = useMemo(() => (
    Object.values(daySummaries).reduce(
      (summary, day) => ({
        workedSeconds: summary.workedSeconds + day.workedSeconds,
        breakSeconds: summary.breakSeconds + day.breakSeconds,
        sessionCount: summary.sessionCount + day.sessionCount,
        activeDays: summary.activeDays + (day.sessionCount > 0 ? 1 : 0),
      }),
      { workedSeconds: 0, breakSeconds: 0, sessionCount: 0, activeDays: 0 },
    )
  ), [daySummaries]);

  const monthEmployeeSummaries = useMemo(() => {
    const scopedMembers = members.filter((member) => (
      selectedDepartment === 'all'
      || member.employee_department === selectedDepartment
    ));
    return summarizeEmployeesForMonth(filteredEntries, scopedMembers);
  }, [filteredEntries, members, selectedDepartment]);

  const monthAttendanceByDate = useMemo(
    () => new Map(monthAttendance.map((row) => [row.attendance_date, row])),
    [monthAttendance],
  );

  const filteredVoidedEntries = useMemo(() => voidedEntries.filter((entry) => {
    const employeeMatches = selectedEmployeeId === 'all'
      || entry.employee_id === selectedEmployeeId;
    const departmentMatches = selectedDepartment === 'all'
      || entry.employee_department === selectedDepartment;
    const projectFilterActive = selectedProjectId !== 'all';
    const activityFilterActive = selectedActivityId !== 'all';
    const contextMatches = !projectFilterActive && !activityFilterActive
      || (projectFilterActive && entry.context_type === 'project' && entry.context_id === selectedProjectId)
      || (activityFilterActive && entry.context_type === 'activity' && entry.context_id === selectedActivityId);
    return employeeMatches && departmentMatches && contextMatches;
  }), [
    selectedActivityId,
    selectedDepartment,
    selectedEmployeeId,
    selectedProjectId,
    voidedEntries,
  ]);

  const selectedVoidedEntries = filteredVoidedEntries.filter(
    (entry) => dateKey(entry.started_at) === selectedDate,
  );

  const visibleEmployeeCount = useMemo(() => (
    new Set(filteredEntries.map((entry) => entry.employee_id)).size
  ), [filteredEntries]);
  const scopeCopy = SCOPE_COPY[scope];
  const isSharedScope = scope !== 'personal';
  const selectedEntries = entriesByDay[selectedDate] || [];
  const selectedDayWorkMode = (
    scope === 'personal' || selectedEmployeeId !== 'all'
  ) ? selectedEntries[0]?.work_mode || null : null;
  const selectedSummary = daySummaries[selectedDate] || {
    workedSeconds: 0,
    breakSeconds: 0,
    sessionCount: 0,
    hasOpenSession: false,
  };
  const monthCalendarCells = useMemo(() => {
    const leading = new Date(Date.UTC(
      currentMonth.year,
      currentMonth.month - 1,
      1,
    )).getUTCDay();
    return [
      ...Array.from({ length: leading }, () => null),
      ...periodDateKeys,
    ];
  }, [currentMonth.month, currentMonth.year, periodDateKeys]);
  const monthDisplayEmployee = scope === 'personal'
    ? {
      employee_id: user?.id,
      employee_name: user?.name,
      employee_code: user?.emp_code,
    }
    : selectedMember;
  const canCorrectTime = hasPermission(user, PERMISSIONS.CORRECT_SCOPED_TIME_ENTRIES);
  const canCorrectPersonal = [ROLES.ADMIN, ROLES.SUPERADMIN].includes(userRole);
  const canUseManualEditor = canCorrectTime && (scope !== 'personal' || canCorrectPersonal);
  const selectedManualEmployee = scope === 'personal'
    ? {
      employee_id: user?.id,
      employee_name: user?.name,
      employee_code: user?.emp_code,
    }
    : selectedMember;

  const clearFilters = () => {
    setSelectedEmployeeId('all');
    setSelectedDepartment('all');
    setSelectedProjectId('all');
    setSelectedActivityId('all');
  };

  const moveWeek = (offset) => {
    const nextDate = addDays(new Date(`${selectedDate}T12:00:00Z`), offset * 7);
    setWeekStart(startOfWeek(nextDate));
    setSelectedDate(dateKey(nextDate));
  };

  const moveDay = (offset) => {
    const nextDate = addDays(new Date(`${selectedDate}T12:00:00Z`), offset);
    setWeekStart(startOfWeek(nextDate));
    setSelectedDate(dateKey(nextDate));
  };

  const moveMonth = (offset) => {
    const [year, month, day] = selectedDate.split('-').map(Number);
    const nextMonth = new Date(Date.UTC(year, month - 1 + offset, 1, 12));
    const nextBounds = monthBounds(nextMonth);
    const nextDay = Math.min(day, nextBounds.days);
    setSelectedDate(`${nextBounds.start.slice(0, 8)}${String(nextDay).padStart(2, '0')}`);
  };

  const changeViewMode = (nextView) => {
    setViewMode(nextView);
    if (nextView === 'week') {
      setWeekStart(startOfWeek(new Date(`${selectedDate}T12:00:00Z`)));
    }
  };

  const jumpToDate = (value) => {
    if (!value) return;
    const nextDate = new Date(`${value}T12:00:00Z`);
    if (Number.isNaN(nextDate.getTime())) return;
    setWeekStart(startOfWeek(nextDate));
    setSelectedDate(dateKey(nextDate));
  };

  const goToCurrentWeek = () => {
    const today = new Date();
    setWeekStart(startOfWeek(today));
    setSelectedDate(dateKey(today));
  };

  const changeScope = (nextScope) => {
    setScope(nextScope);
    clearFilters();
  };

  const closeManualEditor = () => {
    if (manualSaving) return;
    setManualEditor(null);
    setManualContexts([]);
    setManualError('');
  };

  const openManualEditor = async (mode, entry = null) => {
    const employee = entry
      ? {
        employee_id: entry.employee_id,
        employee_name: entry.employee_name,
        employee_code: entry.employee_code,
      }
      : selectedManualEmployee;

    if (!employee?.employee_id) {
      setError('Choose a person before adding a manual time entry.');
      return;
    }

    setManualError('');
    setManualContextsLoading(true);
    setManualEditor({ mode, entry, employee });

    const { data, error: contextError } = await supabase.rpc(
      'manual_time_entry_contexts',
      { target_employee_id: employee.employee_id },
    );

    if (contextError) {
      setManualContexts([]);
      setManualError(contextError.message || 'Unable to load permitted work contexts.');
      setManualContextsLoading(false);
      return;
    }

    const contexts = data || [];
    const currentContext = entry
      ? {
        context_type: entry.context_type,
        context_id: entry.context_id,
        context_label: entry.context_label,
      }
      : null;
    const currentContextMissing = currentContext && !contexts.some(
      (context) => (
        context.context_type === currentContext.context_type
        && context.context_id === currentContext.context_id
      ),
    );
    const availableContexts = currentContextMissing
      ? [currentContext, ...contexts]
      : contexts;
    const contextValue = entry
      ? `${entry.context_type}:${entry.context_id}`
      : availableContexts[0]
        ? `${availableContexts[0].context_type}:${availableContexts[0].context_id}`
        : '';

    setManualContexts(availableContexts);
    const suggestedRange = nextManualEntryRange(selectedDate, selectedEntries);
    setManualForm(entry ? {
      context: contextValue,
      workMode: entry.work_mode || '',
      taskDescription: entry.task_description,
      startedAt: toLocalDateTimeInput(entry.started_at),
      endedAt: toLocalDateTimeInput(entry.ended_at),
      breaks: (entry.breaks || []).map((breakEntry) => ({
        startedAt: toLocalDateTimeInput(breakEntry.started_at),
        endedAt: toLocalDateTimeInput(breakEntry.ended_at),
      })),
      reason: '',
    } : {
      ...defaultManualForm(selectedDate),
      ...suggestedRange,
      context: contextValue,
    });
    setManualContextsLoading(false);
  };

  const updateManualBreak = (index, field, value) => {
    setManualForm((current) => ({
      ...current,
      breaks: current.breaks.map((breakEntry, breakIndex) => (
        breakIndex === index ? { ...breakEntry, [field]: value } : breakEntry
      )),
    }));
  };

  const removeManualBreak = (index) => {
    setManualForm((current) => ({
      ...current,
      breaks: current.breaks.filter((_, breakIndex) => breakIndex !== index),
    }));
  };

  const addManualBreak = () => {
    setManualForm((current) => ({
      ...current,
      breaks: [
        ...current.breaks,
        suggestedBreakRange(current.startedAt, current.endedAt),
      ],
    }));
  };

  const saveManualEntry = async (event) => {
    event.preventDefault();
    if (!manualEditor) return;
    const saveIntent = event.nativeEvent.submitter?.value || 'close';

    setManualError('');

    if (!manualForm.context) {
      setManualError('Select a project or internal activity.');
      return;
    }

    if (!['office', 'wfh'].includes(manualForm.workMode)) {
      setManualError('Select Office or WFH for this attendance day.');
      return;
    }

    if (!manualForm.taskDescription.trim() || !manualForm.reason.trim()) {
      setManualError('Task description and change reason are required.');
      return;
    }

    const startedAt = new Date(appDateTimeInputToIso(manualForm.startedAt));
    const endedAt = new Date(appDateTimeInputToIso(manualForm.endedAt));
    if (
      Number.isNaN(startedAt.getTime())
      || Number.isNaN(endedAt.getTime())
      || endedAt <= startedAt
    ) {
      setManualError('Choose a completed positive-duration time range.');
      return;
    }

    const parsedBreaks = manualForm.breaks.map((breakEntry) => ({
      startedAt: new Date(appDateTimeInputToIso(breakEntry.startedAt)),
      endedAt: new Date(appDateTimeInputToIso(breakEntry.endedAt)),
    }));
    if (parsedBreaks.some((breakEntry) => (
      Number.isNaN(breakEntry.startedAt.getTime())
      || Number.isNaN(breakEntry.endedAt.getTime())
      || breakEntry.endedAt <= breakEntry.startedAt
      || breakEntry.startedAt < startedAt
      || breakEntry.endedAt > endedAt
    ))) {
      setManualError('Every break must have a positive duration inside the work-entry range.');
      return;
    }
    const breaks = parsedBreaks.map((breakEntry) => ({
      started_at: breakEntry.startedAt.toISOString(),
      ended_at: breakEntry.endedAt.toISOString(),
    }));

    const [contextType, contextId] = manualForm.context.split(':');
    const payload = {
      target_project_id: contextType === 'project' ? contextId : null,
      target_activity_id: contextType === 'activity' ? contextId : null,
      entry_task_description: manualForm.taskDescription,
      entry_started_at: startedAt.toISOString(),
      entry_ended_at: endedAt.toISOString(),
      entry_breaks: breaks,
      change_reason: manualForm.reason,
      entry_work_mode: manualForm.workMode,
    };

    setManualSaving(true);
    try {
      const { error: saveError } = manualEditor.mode === 'edit'
        ? await supabase.rpc('correct_manual_time_entry', {
          target_work_entry_id: manualEditor.entry.work_entry_id,
          ...payload,
        })
        : await supabase.rpc('create_manual_time_entry', {
          target_employee_id: manualEditor.employee.employee_id,
          ...payload,
        });

      if (saveError) {
        setManualError(saveError.message || 'Unable to save the manual time entry.');
        return;
      }

      const actionLabel = manualEditor.mode === 'edit'
        ? 'Time entry corrected.'
        : 'Manual time entry added.';
      const refreshResult = await loadTimesheet();
      if (manualEditor.mode === 'edit' || saveIntent === 'close') {
        setManualEditor(null);
        setManualContexts([]);
      } else {
        const nextDate = saveIntent === 'next-day'
          ? dateKey(addDays(new Date(`${selectedDate}T12:00:00Z`), 1))
          : selectedDate;
        const nextRange = saveIntent === 'next-day'
          ? nextManualEntryRange(nextDate)
          : nextManualEntryRange(selectedDate, [{ ended_at: endedAt.toISOString() }]);
        if (saveIntent === 'next-day') {
          setSelectedDate(nextDate);
          setWeekStart(startOfWeek(new Date(`${nextDate}T12:00:00Z`)));
        }
        setManualEditor((current) => ({ ...current, mode: 'create', entry: null }));
        setManualForm((current) => ({
          ...defaultManualForm(nextDate),
          ...nextRange,
          context: current.context,
          workMode: current.workMode,
        }));
      }
      setNotice({
        type: refreshResult.error ? 'error' : 'success',
        text: refreshResult.error
          ? `${actionLabel} The latest timesheet could not be refreshed; use Try again below.`
          : saveIntent === 'next-day'
            ? `${actionLabel} Ready for the next day.`
            : saveIntent === 'another'
              ? `${actionLabel} Add the next entry below.`
              : actionLabel,
      });
    } catch (saveError) {
      setManualError(saveError.message || 'Unable to save the manual time entry.');
    } finally {
      setManualSaving(false);
    }
  };

  const closeVoidEditor = () => {
    if (voidSaving) return;
    setVoidEditor(null);
    setVoidReason('');
    setVoidError('');
  };

  const saveVoidEntry = async (event) => {
    event.preventDefault();
    if (!voidEditor) return;
    if (!voidReason.trim()) {
      setVoidError('A reason is required so the change remains auditable.');
      return;
    }

    setVoidSaving(true);
    setVoidError('');
    const { error: saveError } = await supabase.rpc('void_manual_time_entry', {
      target_work_entry_id: voidEditor.work_entry_id,
      change_reason: voidReason.trim(),
    });
    if (saveError) {
      setVoidError(saveError.message || 'Unable to void this time entry.');
      setVoidSaving(false);
      return;
    }

    const refreshResult = await loadTimesheet();
    setVoidSaving(false);
    setVoidEditor(null);
    setVoidReason('');
    setNotice({
      type: refreshResult.error ? 'error' : 'success',
      text: refreshResult.error
        ? 'Entry voided, but the latest timesheet could not be refreshed.'
        : 'Entry voided. It is excluded from totals and retained in history.',
    });
  };

  const closeHistory = () => {
    setHistoryViewer(null);
    setHistory([]);
    setHistoryError('');
  };

  const loadHistory = async (entry) => {
    setHistoryLoading(true);
    setHistoryError('');

    const { data, error: historyFetchError } = await supabase.rpc(
      'work_entry_change_history',
      { target_work_entry_id: entry.work_entry_id },
    );

    if (historyFetchError) {
      setHistory([]);
      setHistoryError(
        historyFetchError.message || 'Unable to load change history.',
      );
    } else {
      setHistory(data || []);
    }
    setHistoryLoading(false);
  };

  const openHistory = (entry) => {
    setHistoryViewer(entry);
    void loadHistory(entry);
  };

  const manualEditorRef = useDialogFocus(
    Boolean(manualEditor),
    closeManualEditor,
    { closeDisabled: manualSaving },
  );
  const historyViewerRef = useDialogFocus(Boolean(historyViewer), closeHistory);
  const voidEditorRef = useDialogFocus(Boolean(voidEditor), closeVoidEditor, {
    closeDisabled: voidSaving,
  });

  return (
    <Layout
      title="Timesheets"
      eyebrow={scopeCopy.eyebrow}
      heading={scopeCopy.heading}
      description={scopeCopy.description}
      actions={(
        <div className="timesheet-page-actions">
          {canUseManualEditor && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => openManualEditor('create')}
              disabled={!selectedManualEmployee?.employee_id}
              title={selectedManualEmployee?.employee_id ? '' : 'Choose a person first'}
            >
              <i className="ri-add-line" />
              Add time
            </button>
          )}
        </div>
      )}
    >
      {notice && (
        <div
          className={`people-feedback people-feedback--${notice.type}`}
          role={notice.type === 'error' ? 'alert' : 'status'}
        >
          <i className={notice.type === 'error' ? 'ri-error-warning-line' : 'ri-checkbox-circle-line'} />
          {notice.text}
        </div>
      )}

      {error && (entries.length > 0 || members.length > 0) && (
        <AppState
          compact
          type="error"
          title="Timesheet could not be refreshed"
          message={error}
          action={(
            <button type="button" className="btn btn-outline" onClick={loadTimesheet}>
              Try again
            </button>
          )}
        />
      )}

      {(availableScopes.length > 1 || isSharedScope) && (
        <section className="filter-bar timesheet-controls" aria-label="Timesheet scope">
          {availableScopes.length > 1 && (
            <div className="app-tabs">
              {availableScopes.map((availableScope) => (
                <button
                  type="button"
                  className={`app-tab${scope === availableScope ? ' active' : ''}`}
                  key={availableScope}
                  onClick={() => changeScope(availableScope)}
                >
                  {SCOPE_COPY[availableScope].label}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="surface timesheet-view-controls" aria-label="Timesheet view">
        <div className="app-tabs" role="tablist" aria-label="Timesheet period">
          <button
            type="button"
            className={`app-tab${viewMode === 'week' ? ' active' : ''}`}
            role="tab"
            aria-selected={viewMode === 'week'}
            onClick={() => changeViewMode('week')}
          >
            Week
          </button>
          <button
            type="button"
            className={`app-tab${viewMode === 'month' ? ' active' : ''}`}
            role="tab"
            aria-selected={viewMode === 'month'}
            onClick={() => changeViewMode('month')}
          >
            Month
          </button>
        </div>
        <span>
          {viewMode === 'week'
            ? formatWeekRange(weekStart)
            : formatMonthTitle(currentMonth.start)}
        </span>
      </section>

      <section className="surface timesheet-filter-panel" aria-label="Timesheet filters">
        <div className="timesheet-filter-heading">
          <div>
            <span className="page-eyebrow">Filters</span>
            <h3>Focus this {viewMode}</h3>
            <p>Project and activity selections are combined; other filters narrow the result.</p>
          </div>
          {activeFilters.length > 0 && (
            <button type="button" className="timesheet-clear-filters" onClick={clearFilters}>
              <i className="ri-filter-off-line" />
              Clear all
            </button>
          )}
        </div>

        <div className="timesheet-filter-grid">
          {isSharedScope && (
            <div className="timesheet-filter-field timesheet-person-filter">
              <div className="timesheet-filter-field-heading">
                <span>Employee</span>
                <ContextNavigator
                  compact
                  ariaLabel="Browse timesheets by person"
                  positionLabel={selectedEmployeeId === 'all'
                    ? `${navigableMembers.length} people`
                    : `${employeeNavigation.position} of ${employeeNavigation.total}`}
                  previousLabel={previousEmployee
                    ? `Previous person: ${previousEmployee.employee_name}`
                    : 'No previous person'}
                  nextLabel={nextEmployee
                    ? `Next person: ${nextEmployee.employee_name}`
                    : 'No next person'}
                  previousDisabled={!previousEmployee}
                  nextDisabled={!nextEmployee}
                  disabled={loading}
                  onPrevious={() => setSelectedEmployeeId(previousEmployee.employee_id)}
                  onNext={() => setSelectedEmployeeId(nextEmployee.employee_id)}
                />
              </div>
              <select
                value={selectedEmployeeId}
                onChange={(event) => setSelectedEmployeeId(event.target.value)}
                disabled={loading}
                aria-label="Employee"
              >
                <option value="all">
                  {scope === 'organisation' ? 'All people' : 'Entire managed team'}
                </option>
                {employeeOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          )}

          <label className="timesheet-filter-field">
            <span>Department</span>
            <select
              value={selectedDepartment}
              onChange={(event) => setSelectedDepartment(event.target.value)}
              disabled={loading}
            >
              <option value="all">All departments</option>
              {departmentOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="timesheet-filter-field">
            <span>Project</span>
            <select
              value={selectedProjectId}
              onChange={(event) => setSelectedProjectId(event.target.value)}
              disabled={loading}
            >
              <option value="all">All projects</option>
              {projectOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="timesheet-filter-field">
            <span>Activity</span>
            <select
              value={selectedActivityId}
              onChange={(event) => setSelectedActivityId(event.target.value)}
              disabled={loading}
            >
              <option value="all">All activities</option>
              {activityOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>

        {activeFilters.length > 0 && (
          <div className="timesheet-active-filters" aria-label="Active timesheet filters">
            <span>{activeFilters.length} active</span>
            {activeFilters.map((filter) => (
              <span className="timesheet-filter-chip" key={filter.key}>
                <small>{filter.label}</small>
                {filter.value}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="timesheet-summary" aria-label={`${viewMode === 'week' ? 'Weekly' : 'Monthly'} summary`}>
        <article className="timesheet-summary-card timesheet-summary-card--primary">
          <span>
            {selectedMember
              ? `${selectedMember.employee_name} · worked`
              : `Worked this ${viewMode}`}
          </span>
          <strong>{formatDuration(periodSummary.workedSeconds)}</strong>
          <small>Break time is excluded</small>
        </article>
        <article className="timesheet-summary-card">
          <span>Breaks</span>
          <strong>{formatDuration(periodSummary.breakSeconds)}</strong>
          <small>Across {periodSummary.sessionCount} session{periodSummary.sessionCount === 1 ? '' : 's'}</small>
        </article>
        <article className="timesheet-summary-card">
          <span>{isSharedScope ? 'People with entries' : 'Active days'}</span>
          <strong>{isSharedScope ? visibleEmployeeCount : periodSummary.activeDays}</strong>
          <small>
            {isSharedScope
              ? `${members.length} available in this scope`
              : viewMode === 'week' ? 'of 7 days in this week' : `of ${currentMonth.days} days in this month`}
          </small>
        </article>
      </section>

      {viewMode === 'week' ? (
      <section className="surface timesheet-week">
        <div className="timesheet-week-toolbar">
          <div className="timesheet-week-navigation">
            <button type="button" className="timesheet-nav-button" onClick={() => moveWeek(-1)} aria-label="Previous week">
              <i className="ri-arrow-left-s-line" />
            </button>
            <div>
              <span className="page-eyebrow">Week</span>
              <h3>{formatWeekRange(weekStart)}</h3>
            </div>
            <button type="button" className="timesheet-nav-button" onClick={() => moveWeek(1)} aria-label="Next week">
              <i className="ri-arrow-right-s-line" />
            </button>
          </div>
          <div className="timesheet-week-jump">
            <label>
              <span>Jump to date</span>
              <input
                type="date"
                value={selectedDate}
                onInput={(event) => jumpToDate(event.currentTarget.value)}
              />
            </label>
            <button type="button" className="btn btn-outline" onClick={goToCurrentWeek}>
              This week
            </button>
          </div>
        </div>

        {loading ? (
          <AppState
            type="loading"
            title={isSharedScope ? 'Loading scoped timesheets' : 'Loading your week'}
            message="Collecting sessions and break totals."
            compact
          />
        ) : error && entries.length === 0 && members.length === 0 ? (
          <AppState
            type="error"
            title="Timesheet unavailable"
            message={error}
            action={(
              <button type="button" className="btn btn-outline" onClick={loadTimesheet}>
                Try again
              </button>
            )}
            compact
          />
        ) : (
          <>
            <div className="timesheet-days" role="tablist" aria-label="Days in selected week">
              {weekDays.map((day) => {
                const key = dateKey(day);
                const summary = daySummaries[key];
                const isSelected = key === selectedDate;
                const isToday = key === dateKey(new Date());
                return (
                  <button
                    type="button"
                    className={`timesheet-day${isSelected ? ' timesheet-day--selected' : ''}`}
                    key={key}
                    onClick={() => setSelectedDate(key)}
                    role="tab"
                    aria-selected={isSelected}
                  >
                    <span>{formatAppDate(day, { weekday: 'short', day: undefined, month: undefined, year: undefined })}</span>
                    <strong>{day.getUTCDate()}</strong>
                    <b>{formatDuration(summary.workedSeconds)}</b>
                    <small>
                      {summary.sessionCount
                        ? `${summary.sessionCount} session${summary.sessionCount === 1 ? '' : 's'}`
                        : 'No entries'}
                    </small>
                    {isToday && <i className="timesheet-today-dot" aria-label="Today" />}
                  </button>
                );
              })}
            </div>

            <div className="timesheet-detail">
              <div className="timesheet-detail-header">
                <div className="timesheet-detail-navigation">
                  <button type="button" className="timesheet-nav-button" onClick={() => moveDay(-1)} aria-label="Previous day">
                    <i className="ri-arrow-left-s-line" />
                  </button>
                  <div>
                    <span className="page-eyebrow">Day detail</span>
                    <h3>
                      {formatAppDate(selectedDate, {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                        year: undefined,
                      })}
                    </h3>
                  </div>
                  <button type="button" className="timesheet-nav-button" onClick={() => moveDay(1)} aria-label="Next day">
                    <i className="ri-arrow-right-s-line" />
                  </button>
                </div>
                <div className="timesheet-day-totals">
                  <span className={`timesheet-day-status${selectedSummary.hasOpenSession ? ' timesheet-day-status--open' : ''}`}>
                    <small>Day status</small>
                    <strong>
                      {selectedSummary.hasOpenSession
                        ? 'Open entry'
                        : selectedSummary.sessionCount ? 'Recorded' : 'No time'}
                    </strong>
                  </span>
                  {selectedDayWorkMode && (
                    <span className={`timesheet-work-mode timesheet-work-mode--${selectedDayWorkMode}`}>
                      <small>Work mode</small>
                      <strong>{formatWorkMode(selectedDayWorkMode)}</strong>
                    </span>
                  )}
                  <span>
                    <small>Worked</small>
                    <strong>{formatDuration(selectedSummary.workedSeconds)}</strong>
                  </span>
                  <span>
                    <small>Breaks</small>
                    <strong>{formatDuration(selectedSummary.breakSeconds)}</strong>
                  </span>
                </div>
              </div>

              {selectedEntries.length === 0 ? (
                <AppState
                  type="empty"
                  title={
                    activeFilters.length > 0
                      ? 'No entries match these filters'
                      : isSharedScope ? 'No scoped work tracked' : 'No work tracked'
                  }
                  message={
                    activeFilters.length > 0
                      ? 'Try another day or clear the active filters to restore the full week.'
                      : isSharedScope
                      ? 'There are no permitted sessions for this selection and day.'
                      : 'There are no sessions recorded for this day.'
                  }
                  action={activeFilters.length > 0 ? (
                    <button type="button" className="btn btn-outline" onClick={clearFilters}>
                      Clear filters
                    </button>
                  ) : null}
                  compact
                />
              ) : (
                <ol className="timesheet-timeline">
                  {selectedEntries.map((entry) => (
                    <li className="timesheet-session" key={entry.work_entry_id}>
                      <span className={`timesheet-context-icon timesheet-context-icon--${entry.context_type}`}>
                        <i className={entry.context_type === 'project' ? 'ri-folder-3-line' : 'ri-flashlight-line'} />
                      </span>
                      <div className="timesheet-session-body">
                        <div className="timesheet-session-heading">
                          <div>
                            {isSharedScope && (
                              <span className="timesheet-person">
                                {entry.employee_name} · {entry.employee_code}
                              </span>
                            )}
                            <span className="timesheet-context-type">
                              {entry.context_type === 'project' ? 'Project' : 'Activity'}
                            </span>
                            <h4>{entry.context_label}</h4>
                          </div>
                          <span className="timesheet-session-duration">
                            {formatDuration(entry.worked_seconds)}
                          </span>
                        </div>
                        <p>{entry.task_description || 'No task description recorded.'}</p>
                        <div className="timesheet-session-meta">
                          <span>
                            <i className="ri-time-line" />
                            {formatClock(entry.started_at)} – {formatClock(entry.ended_at)}
                          </span>
                          {!entry.ended_at && <span className="badge success">In progress</span>}
                          <button
                            type="button"
                            className="timesheet-edit-button"
                            onClick={() => openHistory(entry)}
                          >
                            <i className="ri-history-line" />
                            History
                          </button>
                          {canUseManualEditor && entry.ended_at && (
                            <button
                              type="button"
                              className="timesheet-edit-button"
                              onClick={() => openManualEditor('edit', entry)}
                            >
                              <i className="ri-pencil-line" />
                              Correct entry
                            </button>
                          )}
                          {canUseManualEditor && entry.ended_at && (
                            <button
                              type="button"
                              className="timesheet-edit-button timesheet-edit-button--danger"
                              onClick={() => {
                                setVoidEditor(entry);
                                setVoidReason('');
                                setVoidError('');
                              }}
                            >
                              <i className="ri-close-circle-line" />
                              Void entry
                            </button>
                          )}
                        </div>
                        {(entry.breaks || []).length > 0 && (
                          <div className="timesheet-break-list">
                            {(entry.breaks || []).map((breakEntry) => (
                              <div key={breakEntry.id}>
                                <span>
                                  <i className="ri-cup-line" />
                                  Break · {formatClock(breakEntry.started_at)} – {formatClock(breakEntry.ended_at)}
                                </span>
                                <strong>{formatDuration(breakEntry.duration_seconds)}</strong>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              {selectedVoidedEntries.length > 0 && (
                <details className="timesheet-voided-list">
                  <summary>{selectedVoidedEntries.length} voided entr{selectedVoidedEntries.length === 1 ? 'y' : 'ies'}</summary>
                  {selectedVoidedEntries.map((entry) => (
                    <div key={entry.work_entry_id}>
                      <span>
                        <strong>{entry.context_label}</strong>
                        <small>{formatClock(entry.started_at)} – {formatClock(entry.ended_at)} · {entry.void_reason}</small>
                      </span>
                      <button type="button" onClick={() => openHistory(entry)}>View history</button>
                    </div>
                  ))}
                </details>
              )}
            </div>
          </>
        )}
      </section>
      ) : (
        <section className="surface timesheet-month" aria-labelledby="timesheet-month-title">
          <div className="timesheet-month-toolbar">
            <div className="timesheet-week-navigation">
              <button type="button" className="timesheet-nav-button" onClick={() => moveMonth(-1)} aria-label="Previous month">
                <i className="ri-arrow-left-s-line" />
              </button>
              <div>
                <span className="page-eyebrow">Month</span>
                <h3 id="timesheet-month-title">{formatMonthTitle(currentMonth.start)}</h3>
              </div>
              <button type="button" className="timesheet-nav-button" onClick={() => moveMonth(1)} aria-label="Next month">
                <i className="ri-arrow-right-s-line" />
              </button>
            </div>
            <button type="button" className="btn btn-outline" onClick={() => {
              const today = dateKey(new Date());
              setSelectedDate(today);
            }}>
              This month
            </button>
          </div>

          {loading ? (
            <AppState type="loading" title="Loading this month" message="Collecting timesheet totals." compact />
          ) : isSharedScope && selectedEmployeeId === 'all' ? (
            <div className="timesheet-month-team">
              <header>
                <div>
                  <span className="page-eyebrow">People</span>
                  <h3>Month summary</h3>
                </div>
                <small>Select a person to open their calendar.</small>
              </header>
              {monthEmployeeSummaries.length === 0 ? (
                <AppState
                  type="empty"
                  title="No people in this selection"
                  message="Clear filters or choose another scope."
                  compact
                />
              ) : (
                <div className="timesheet-month-people">
                  {monthEmployeeSummaries.map((member) => (
                    <button
                      type="button"
                      key={member.employee_id}
                      onClick={() => setSelectedEmployeeId(member.employee_id)}
                    >
                      <span className="timesheet-month-person-name">
                        <strong>{member.employee_name}</strong>
                        <small>{member.employee_code} · {member.employee_department || 'No department'}</small>
                      </span>
                      <span><small>Worked</small><strong>{formatDuration(member.workedSeconds)}</strong></span>
                      <span><small>Breaks</small><strong>{formatDuration(member.breakSeconds)}</strong></span>
                      <span><small>Days</small><strong>{member.activeDays}</strong></span>
                      <i className="ri-arrow-right-s-line" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="timesheet-month-person">
                <span>
                  {monthDisplayEmployee?.employee_name || 'Selected person'}
                  {monthDisplayEmployee?.employee_code ? ` · ${monthDisplayEmployee.employee_code}` : ''}
                </span>
                {monthAttendanceLoading && <small>Loading day context…</small>}
              </div>
              <div className="timesheet-month-weekdays" aria-hidden="true">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span key={day}>{day}</span>)}
              </div>
              <div className="timesheet-month-calendar" role="group" aria-label={`${formatMonthTitle(currentMonth.start)} timesheet`}>
                {monthCalendarCells.map((day, index) => {
                  if (!day) return <span className="timesheet-month-blank" aria-hidden="true" key={`blank-${index}`} />;
                  const summary = daySummaries[day];
                  const attendanceRow = monthAttendanceByDate.get(day);
                  const attendanceState = resolveAttendanceDayState(attendanceRow, dateKey(new Date()));
                  const stateLabel = summary?.sessionCount
                    ? summary.hasOpenSession ? 'Open entry' : 'Recorded'
                    : activeFilters.length > 0 ? 'No match' : MONTH_DAY_STATE_COPY[attendanceState];
                  return (
                    <button
                      type="button"
                      key={day}
                      className={`timesheet-month-day timesheet-month-day--${attendanceState}${day === selectedDate ? ' timesheet-month-day--selected' : ''}`}
                      aria-pressed={day === selectedDate}
                      aria-label={`${formatAppDate(day, { weekday: 'long', month: 'long' })}: ${summary?.sessionCount ? formatDuration(summary.workedSeconds) : stateLabel}`}
                      onClick={() => setSelectedDate(day)}
                    >
                      <span>{Number(day.slice(-2))}</span>
                      <strong>{summary?.sessionCount ? formatDuration(summary.workedSeconds) : '—'}</strong>
                      <small>{stateLabel}</small>
                      {summary?.breakSeconds > 0 && <em>{formatDuration(summary.breakSeconds)} break</em>}
                    </button>
                  );
                })}
              </div>

              <div className="timesheet-month-detail">
                <div className="timesheet-detail-header">
                  <div>
                    <span className="page-eyebrow">Selected day</span>
                    <h3>{formatAppDate(selectedDate, { weekday: 'long', month: 'long' })}</h3>
                  </div>
                  <div className="timesheet-day-totals">
                    <span className={`timesheet-day-status${selectedSummary.hasOpenSession ? ' timesheet-day-status--open' : ''}`}>
                      <small>Day status</small>
                      <strong>{selectedSummary.hasOpenSession ? 'Open entry' : selectedSummary.sessionCount ? 'Recorded' : 'No time'}</strong>
                    </span>
                    <span><small>Worked</small><strong>{formatDuration(selectedSummary.workedSeconds)}</strong></span>
                    <span><small>Breaks</small><strong>{formatDuration(selectedSummary.breakSeconds)}</strong></span>
                    {canUseManualEditor && (
                      <button type="button" className="btn btn-primary" onClick={() => openManualEditor('create')}>
                        <i className="ri-add-line" /> Add time
                      </button>
                    )}
                  </div>
                </div>
                {selectedEntries.length === 0 ? (
                  <AppState type="empty" title="No time recorded" message="Choose another date or add time if you are authorised." compact />
                ) : (
                  <ol className="timesheet-timeline timesheet-month-timeline">
                    {selectedEntries.map((entry) => (
                      <li className="timesheet-session" key={entry.work_entry_id}>
                        <span className={`timesheet-context-icon timesheet-context-icon--${entry.context_type}`}>
                          <i className={entry.context_type === 'project' ? 'ri-folder-3-line' : 'ri-flashlight-line'} />
                        </span>
                        <div className="timesheet-session-body">
                          <div className="timesheet-session-heading">
                            <div><span className="timesheet-context-type">{entry.context_type}</span><h4>{entry.context_label}</h4></div>
                            <span className="timesheet-session-duration">{formatDuration(entry.worked_seconds)}</span>
                          </div>
                          <p>{entry.task_description || 'No task description recorded.'}</p>
                          <div className="timesheet-session-meta">
                            <span><i className="ri-time-line" />{formatClock(entry.started_at)} – {formatClock(entry.ended_at)}</span>
                            <button type="button" className="timesheet-edit-button" onClick={() => openHistory(entry)}>History</button>
                            {canUseManualEditor && entry.ended_at && (
                              <button type="button" className="timesheet-edit-button" onClick={() => openManualEditor('edit', entry)}>Correct entry</button>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
                {selectedVoidedEntries.length > 0 && (
                  <details className="timesheet-voided-list">
                    <summary>{selectedVoidedEntries.length} voided entr{selectedVoidedEntries.length === 1 ? 'y' : 'ies'}</summary>
                    {selectedVoidedEntries.map((entry) => (
                      <div key={entry.work_entry_id}>
                        <span><strong>{entry.context_label}</strong><small>{entry.void_reason}</small></span>
                        <button type="button" onClick={() => openHistory(entry)}>View history</button>
                      </div>
                    ))}
                  </details>
                )}
              </div>
            </>
          )}
        </section>
      )}

      {manualEditor && (
        <div className="timesheet-editor-overlay" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeManualEditor();
        }}>
          <aside
            ref={manualEditorRef}
            className="timesheet-editor"
            role="dialog"
            aria-modal="true"
            aria-labelledby="manual-entry-title"
            tabIndex="-1"
          >
            <header className="timesheet-editor-header">
              <div>
                <span className="page-eyebrow">
                  {manualEditor.mode === 'edit' ? 'Correction' : 'Manual entry'}
                </span>
                <h2 id="manual-entry-title">
                  {manualEditor.mode === 'edit' ? 'Correct time entry' : 'Add time entry'}
                </h2>
                <p>
                  {manualEditor.employee.employee_name}
                  {manualEditor.employee.employee_code
                    ? ` · ${manualEditor.employee.employee_code}`
                    : ''}
                  {' · '}
                  {formatAppDate(manualForm.startedAt.slice(0, 10), {
                    weekday: 'short',
                    month: 'short',
                  })}
                </p>
              </div>
              <button
                type="button"
                className="timesheet-editor-close"
                onClick={closeManualEditor}
                aria-label="Close manual time entry"
              >
                <i className="ri-close-line" />
              </button>
            </header>

            <form className="timesheet-editor-form" onSubmit={saveManualEntry}>
              {manualError && (
                <div className="alert-banner error">
                  <i className="ri-error-warning-line alert-icon" />
                  <div className="alert-content">
                    <span className="alert-title">Entry not saved</span>
                    <span className="alert-desc">{manualError}</span>
                  </div>
                </div>
              )}

              <section className="timesheet-entry-sequence" aria-label="Manual entry sequence">
                <div>
                  <span className="timesheet-sequence-dot" />
                  <small>{formatClock(appDateTimeInputToIso(manualForm.startedAt), 'Start')}</small>
                  <strong>Start work</strong>
                </div>
                {manualForm.breaks.map((breakEntry, index) => (
                  <React.Fragment key={`sequence-${index}-${breakEntry.startedAt}`}>
                    <div className="timesheet-entry-sequence--break">
                      <span className="timesheet-sequence-dot" />
                      <small>{formatClock(appDateTimeInputToIso(breakEntry.startedAt), 'Start')}</small>
                      <strong>Start break</strong>
                    </div>
                    <div>
                      <span className="timesheet-sequence-dot" />
                      <small>{formatClock(appDateTimeInputToIso(breakEntry.endedAt), 'Resume')}</small>
                      <strong>Resume work</strong>
                    </div>
                  </React.Fragment>
                ))}
                <div>
                  <span className="timesheet-sequence-dot" />
                  <small>{formatClock(appDateTimeInputToIso(manualForm.endedAt), 'End')}</small>
                  <strong>End work</strong>
                </div>
              </section>

              <label className="timesheet-field">
                <span>Project or activity</span>
                <select
                  value={manualForm.context}
                  onChange={(event) => setManualForm((current) => ({
                    ...current,
                    context: event.target.value,
                  }))}
                  disabled={manualContextsLoading}
                  required
                >
                  {manualContexts.length === 0 && (
                    <option value="">
                      {manualContextsLoading ? 'Loading…' : 'No permitted contexts'}
                    </option>
                  )}
                  {manualContexts.map((context) => (
                    <option
                      key={`${context.context_type}:${context.context_id}`}
                      value={`${context.context_type}:${context.context_id}`}
                    >
                      {context.context_type === 'project' ? 'Project' : 'Activity'} · {context.context_label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="timesheet-field">
                <span>Work mode for this day</span>
                <select
                  value={manualForm.workMode}
                  onChange={(event) => setManualForm((current) => ({
                    ...current,
                    workMode: event.target.value,
                  }))}
                  required
                >
                  <option value="" disabled>Select work mode</option>
                  <option value="office">Office</option>
                  <option value="wfh">Work from home</option>
                </select>
                <small>This applies to every session on the attendance day.</small>
              </label>

              <label className="timesheet-field">
                <span>Task description</span>
                <textarea
                  rows="3"
                  value={manualForm.taskDescription}
                  onChange={(event) => setManualForm((current) => ({
                    ...current,
                    taskDescription: event.target.value,
                  }))}
                  placeholder="What work was completed?"
                  required
                />
              </label>

              <div className="timesheet-editor-grid">
                <label className="timesheet-field">
                  <span>Start</span>
                  <input
                    type="datetime-local"
                    value={manualForm.startedAt}
                    onChange={(event) => setManualForm((current) => ({
                      ...current,
                      startedAt: event.target.value,
                    }))}
                    required
                  />
                </label>
                <label className="timesheet-field">
                  <span>End</span>
                  <input
                    type="datetime-local"
                    value={manualForm.endedAt}
                    onChange={(event) => setManualForm((current) => ({
                      ...current,
                      endedAt: event.target.value,
                    }))}
                    required
                  />
                </label>
              </div>

              <section className="timesheet-editor-breaks">
                <div>
                  <div>
                    <span>Breaks</span>
                    <small>Optional; each break must stay inside the entry.</small>
                  </div>
                  <button type="button" onClick={addManualBreak}>
                    <i className="ri-add-line" />
                    Add break
                  </button>
                </div>
                {manualForm.breaks.map((breakEntry, index) => (
                  <div className="timesheet-editor-break" key={`${index}-${breakEntry.startedAt}`}>
                    <label className="timesheet-field">
                      <span>Break start</span>
                      <input
                        type="datetime-local"
                        value={breakEntry.startedAt}
                        onChange={(event) => updateManualBreak(
                          index,
                          'startedAt',
                          event.target.value,
                        )}
                        required
                      />
                    </label>
                    <label className="timesheet-field">
                      <span>Break end</span>
                      <input
                        type="datetime-local"
                        value={breakEntry.endedAt}
                        onChange={(event) => updateManualBreak(
                          index,
                          'endedAt',
                          event.target.value,
                        )}
                        required
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => removeManualBreak(index)}
                      aria-label={`Remove break ${index + 1}`}
                    >
                      <i className="ri-delete-bin-line" />
                    </button>
                  </div>
                ))}
              </section>

              <label className="timesheet-field">
                <span>Reason for change</span>
                <textarea
                  rows="3"
                  value={manualForm.reason}
                  onChange={(event) => setManualForm((current) => ({
                    ...current,
                    reason: event.target.value,
                  }))}
                  placeholder="Required for the immutable audit record"
                  required
                />
              </label>

              <footer className="timesheet-editor-footer">
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={closeManualEditor}
                  disabled={manualSaving}
                >
                  Cancel
                </button>
                {manualEditor.mode === 'edit' ? (
                  <button
                    type="submit"
                    value="close"
                    className="btn btn-primary"
                    disabled={manualSaving || manualContextsLoading || manualContexts.length === 0}
                  >
                    {manualSaving ? 'Saving…' : 'Save correction'}
                  </button>
                ) : (
                  <>
                    <button
                      type="submit"
                      value="close"
                      className="btn btn-outline"
                      disabled={manualSaving || manualContextsLoading || manualContexts.length === 0}
                    >
                      Save &amp; close
                    </button>
                    <button
                      type="submit"
                      value="another"
                      className="btn btn-outline"
                      disabled={manualSaving || manualContextsLoading || manualContexts.length === 0}
                    >
                      Save &amp; add another
                    </button>
                    <button
                      type="submit"
                      value="next-day"
                      className="btn btn-primary"
                      disabled={manualSaving || manualContextsLoading || manualContexts.length === 0}
                    >
                      {manualSaving ? 'Saving…' : 'Save & next day'}
                    </button>
                  </>
                )}
              </footer>
            </form>
          </aside>
        </div>
      )}

      {voidEditor && (
        <div className="timesheet-editor-overlay" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeVoidEditor();
        }}>
          <aside
            ref={voidEditorRef}
            className="timesheet-void-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="void-entry-title"
            tabIndex="-1"
          >
            <header>
              <div>
                <span className="page-eyebrow">Manual entry</span>
                <h2 id="void-entry-title">Void this time entry?</h2>
              </div>
              <button type="button" onClick={closeVoidEditor} aria-label="Close void entry dialog">
                <i className="ri-close-line" />
              </button>
            </header>
            <p>
              <strong>{voidEditor.context_label}</strong><br />
              {formatClock(voidEditor.started_at)} – {formatClock(voidEditor.ended_at)}
            </p>
            <div className="timesheet-void-notice">
              <i className="ri-information-line" />
              This removes the entry from totals but keeps it permanently in change history.
            </div>
            <form onSubmit={saveVoidEntry}>
              {voidError && <div className="people-feedback people-feedback--error" role="alert">{voidError}</div>}
              <label className="timesheet-field">
                <span>Reason for voiding</span>
                <textarea
                  rows="3"
                  value={voidReason}
                  onChange={(event) => setVoidReason(event.target.value)}
                  placeholder="For example: Duplicate entry or wrong employee"
                  required
                  autoFocus
                />
              </label>
              <footer>
                <button type="button" className="btn btn-outline" onClick={closeVoidEditor} disabled={voidSaving}>Keep entry</button>
                <button type="submit" className="btn btn-danger" disabled={voidSaving}>{voidSaving ? 'Voiding…' : 'Void entry'}</button>
              </footer>
            </form>
          </aside>
        </div>
      )}

      {historyViewer && (
        <div className="timesheet-editor-overlay" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeHistory();
        }}>
          <aside
            ref={historyViewerRef}
            className="timesheet-editor timesheet-history"
            role="dialog"
            aria-modal="true"
            aria-labelledby="timesheet-history-title"
            tabIndex="-1"
          >
            <header className="timesheet-editor-header">
              <div>
                <span className="page-eyebrow">Immutable audit trail</span>
                <h2 id="timesheet-history-title">Change history</h2>
                <p>
                  {historyViewer.context_label}
                  {historyViewer.employee_name
                    ? ` · ${historyViewer.employee_name}`
                    : ''}
                </p>
              </div>
              <button
                type="button"
                className="timesheet-editor-close"
                onClick={closeHistory}
                aria-label="Close change history"
              >
                <i className="ri-close-line" />
              </button>
            </header>

            <div className="timesheet-history-body">
              <div className="timesheet-history-notice">
                <i className="ri-lock-2-line" />
                <span>This history is read-only and cannot be edited or deleted.</span>
              </div>

              {historyLoading ? (
                <AppState
                  type="loading"
                  title="Loading change history"
                  message="Reading the entry’s immutable audit trail."
                  compact
                />
              ) : historyError ? (
                <AppState
                  type="error"
                  title="History unavailable"
                  message={historyError}
                  action={(
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => loadHistory(historyViewer)}
                    >
                      Try again
                    </button>
                  )}
                  compact
                />
              ) : history.length === 0 ? (
                <AppState
                  type="empty"
                  title="No manual changes"
                  message="This entry has no manual additions or corrections."
                  compact
                />
              ) : (
                <ol className="timesheet-history-list">
                  {history.map((historyItem) => (
                    <li key={historyItem.audit_id}>
                      <article className="timesheet-history-event">
                        <header>
                          <span className={`badge ${
                            historyItem.change_kind === 'created'
                              ? 'success'
                              : historyItem.change_kind === 'voided'
                                ? 'danger'
                                : 'warning'
                          }`}
                          >
                            {historyItem.change_kind === 'created'
                              ? 'Entry added'
                              : historyItem.change_kind === 'voided'
                                ? 'Entry voided'
                                : 'Entry corrected'}
                          </span>
                          <time dateTime={historyItem.changed_at}>
                            {formatDateTime(historyItem.changed_at)}
                          </time>
                        </header>
                        <p className="timesheet-history-editor">
                          <i className="ri-user-line" />
                          {historyItem.editor_name} · {historyItem.editor_code}
                        </p>
                        <div className="timesheet-history-reason">
                          <span>Reason</span>
                          <p>{historyItem.change_reason}</p>
                        </div>
                        <div className="timesheet-history-changes">
                          <div className="timesheet-history-change-head">
                            <span>Field</span>
                            <span>Before</span>
                            <span>After</span>
                          </div>
                          {getAuditChanges(historyItem).map((change) => (
                            <div
                              className="timesheet-history-change"
                              key={change.key}
                            >
                              <strong>{change.label}</strong>
                              <span>{change.before}</span>
                              <span>{change.after}</span>
                            </div>
                          ))}
                        </div>
                      </article>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </aside>
        </div>
      )}
    </Layout>
  );
};

export default Timesheets;
