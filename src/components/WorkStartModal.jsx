import React, { useContext, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AuthContext } from '../context/AuthContext';
import { WorkSessionContext } from '../context/WorkSessionContext';
import { supabase } from '../utils/supabaseClient';
import { isTaskDescriptionValidForMode } from '../utils/workSession';
import useDialogFocus from '../hooks/useDialogFocus';

const optionKey = (type, id) => `${type}:${id}`;

const WorkStartModal = ({
  mode = 'start',
  onClose,
  onComplete,
  subject = null,
  session: sessionOverride,
  dayState: dayStateOverride,
  startSession: startSessionOverride,
  switchSession: switchSessionOverride,
}) => {
  const { user } = useContext(AuthContext);
  const {
    session,
    dayState,
    startSession,
    switchSession,
  } = useContext(WorkSessionContext);
  const activeSession = sessionOverride ?? session;
  const activeDayState = dayStateOverride ?? dayState;
  const employeeId = subject?.id || user.id;
  const isDelegated = Boolean(subject);
  const isSwitch = mode === 'switch';
  const isReopen = !isSwitch && activeDayState.hasWorkToday;
  const [contextType, setContextType] = useState('project');
  const [contextId, setContextId] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [bosReport, setBosReport] = useState('');
  const [isWfh, setIsWfh] = useState(false);
  const [projects, setProjects] = useState([]);
  const [activities, setActivities] = useState([]);
  const [recentEntries, setRecentEntries] = useState([]);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useDialogFocus(true, onClose, { closeDisabled: submitting });

  useEffect(() => {
    let active = true;

    const loadOptions = async () => {
      setLoadingOptions(true);
      setError('');

      const [contextsResult, recentResult] = await Promise.all([
        isDelegated
          ? supabase.rpc('admin_employee_work_contexts', { target_employee_id: employeeId })
          : Promise.all([
            supabase.from('projects').select('id, code, name').is('archived_at', null).order('name', { ascending: true }),
            supabase.from('activities').select('id, name').is('archived_at', null).order('name', { ascending: true }),
          ]),
        supabase
          .from('work_entries')
          .select('project_id, activity_id, task_description, started_at')
          .eq('employee_id', employeeId)
          .order('started_at', { ascending: false })
          .limit(12),
      ]);

      if (!active) return;

      const contextsError = isDelegated
        ? contextsResult.error
        : contextsResult.find((result) => result.error)?.error;
      const loadError = contextsError || recentResult.error;
      if (loadError) {
        console.error('Unable to load start-work choices:', loadError.message);
        setError('Unable to load work choices. Please try again.');
        setLoadingOptions(false);
        return;
      }

      const availableProjects = isDelegated
        ? (contextsResult.data || [])
          .filter((context) => context.context_type === 'project')
          .map((context) => ({ id: context.context_id, code: context.context_code, name: context.context_name }))
        : contextsResult[0].data || [];
      const availableActivities = isDelegated
        ? (contextsResult.data || [])
          .filter((context) => context.context_type === 'activity')
          .map((context) => ({ id: context.context_id, name: context.context_name }))
        : contextsResult[1].data || [];
      const nextProjects = availableProjects.filter(
        (project) => !isSwitch || project.id !== activeSession?.project_id,
      );
      const nextActivities = availableActivities.filter(
        (activity) => !isSwitch || activity.id !== activeSession?.activity_id,
      );
      setProjects(nextProjects);
      setActivities(nextActivities);
      setRecentEntries(recentResult.data || []);

      if (nextProjects.length === 0 && nextActivities.length > 0) {
        setContextType('activity');
      }
      setLoadingOptions(false);
    };

    loadOptions();
    return () => {
      active = false;
    };
  }, [activeSession?.activity_id, activeSession?.project_id, employeeId, isDelegated, isSwitch]);

  const recentChoices = useMemo(() => {
    const projectMap = new Map(projects.map((project) => [
      project.id,
      `${project.code} · ${project.name}`,
    ]));
    const activityMap = new Map(activities.map((activity) => [activity.id, activity.name]));
    const seen = new Set();

    return recentEntries.reduce((choices, entry) => {
      const type = entry.project_id ? 'project' : 'activity';
      const id = entry.project_id || entry.activity_id;
      const label = type === 'project' ? projectMap.get(id) : activityMap.get(id);
      const key = optionKey(type, id);

      if (!label || seen.has(key) || choices.length >= 4) return choices;
      seen.add(key);
      choices.push({
        type,
        id,
        label,
        taskDescription: entry.task_description || '',
      });
      return choices;
    }, []);
  }, [activities, projects, recentEntries]);

  const hasContext = Boolean(contextId);
  const hasTask = isTaskDescriptionValidForMode(taskDescription, mode);
  const needsBos = !isSwitch
    && !activeDayState.hasWorkToday
    && activeDayState.bosRequired
    && !activeDayState.bosSubmitted;
  const hasBos = !needsBos || Boolean(bosReport.trim());
  const canSubmit = hasContext && hasTask && hasBos && !loadingOptions && !submitting;

  const chooseRecent = (choice) => {
    setContextType(choice.type);
    setContextId(choice.id);
    setTaskDescription(isSwitch ? choice.taskDescription || '' : '');
    setError('');
  };

  const handleContextTypeChange = (type) => {
    setContextType(type);
    setContextId('');
    setError('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError('');

    try {
      const selectedOptions = contextType === 'project' ? projects : activities;
      const selectedOption = selectedOptions.find((option) => option.id === contextId);
      if (!selectedOption) throw new Error('Select an available work context');
      const selectedLabel = contextType === 'project'
        ? `${selectedOption.code} · ${selectedOption.name}`
        : selectedOption.name;
      const submitSession = isSwitch
        ? switchSessionOverride || switchSession
        : startSessionOverride || startSession;

      await submitSession({
        projectId: contextType === 'project' ? contextId : null,
        activityId: contextType === 'activity' ? contextId : null,
        taskDescription: isSwitch ? taskDescription.trim() : '',
        bosReport: needsBos ? bosReport.trim() : null,
        workMode: isReopen ? null : isWfh ? 'wfh' : 'office',
      });
      onComplete?.(selectedLabel);
      onClose();
    } catch (submitError) {
      console.error(
        isSwitch ? 'Unable to switch work context:' : 'Unable to start work:',
        submitError.message,
      );
      setError(submitError.message || `Unable to ${isSwitch ? 'switch' : 'start work'}. Please try again.`);
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="work-start-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="work-start-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="work-start-title"
        tabIndex="-1"
      >
        <div className="work-start-header">
          <div>
            <span className="work-start-eyebrow">
              {isSwitch ? 'Switch context' : isReopen ? 'Reopen workday' : 'Start work'}
            </span>
            <h2 id="work-start-title">
              {isSwitch
                ? `What ${isDelegated ? `is ${subject.name}` : 'are you'} switching to?`
                : isReopen
                  ? `What ${isDelegated ? `is ${subject.name}` : 'are you'} returning to?`
                  : `What ${isDelegated ? `is ${subject.name}` : 'are you'} working on?`}
            </h2>
            <p>
              {isSwitch
                ? `Select the new context and describe the task ${isDelegated ? `${subject.name} is` : 'you are'} moving to.`
                : isReopen
                  ? activeDayState.eodSubmitted
                    ? 'Starting again will reopen today, clear the earlier EOD, and require a fresh final EOD when you finish.'
                    : 'Starting again will reopen today’s attendance. Use End Day again when you finish.'
                : needsBos
                  ? 'Add today’s plan, then choose the context for your first session.'
                  : 'Choose one project or internal activity to start work.'}
            </p>
          </div>
          <button
            type="button"
            className="work-start-close"
            onClick={onClose}
            disabled={submitting}
            aria-label={`Close ${isSwitch ? 'switch context' : isReopen ? 'reopen workday' : 'start work'}`}
          >
            <i className="ri-close-line" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {recentChoices.length > 0 && (
            <div className="work-start-recents">
              <span className="work-start-label">Recent</span>
              <div className="work-start-recent-list">
                {recentChoices.map((choice) => (
                  <button
                    type="button"
                    key={optionKey(choice.type, choice.id)}
                    className="work-start-recent"
                    onClick={() => chooseRecent(choice)}
                    title={isSwitch && choice.taskDescription
                      ? `${choice.label} — ${choice.taskDescription}`
                      : choice.label}
                  >
                    <i
                      className={choice.type === 'project' ? 'ri-briefcase-4-line' : 'ri-lightbulb-flash-line'}
                      aria-hidden="true"
                    />
                    <span>{choice.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <fieldset className="work-start-fieldset">
            <legend className="work-start-label">Work context</legend>
            <div className="work-start-type-tabs">
              <button
                type="button"
                className={contextType === 'project' ? 'active' : ''}
                onClick={() => handleContextTypeChange('project')}
                aria-pressed={contextType === 'project'}
                disabled={loadingOptions || projects.length === 0}
              >
                <i className="ri-briefcase-4-line" aria-hidden="true" />
                Project
              </button>
              <button
                type="button"
                className={contextType === 'activity' ? 'active' : ''}
                onClick={() => handleContextTypeChange('activity')}
                aria-pressed={contextType === 'activity'}
                disabled={loadingOptions || activities.length === 0}
              >
                <i className="ri-lightbulb-flash-line" aria-hidden="true" />
                Internal activity
              </button>
            </div>

            <label className="work-start-select-label">
              <span>
                {contextType === 'project' ? 'Assigned project' : 'Internal activity'}
                <b aria-hidden="true">*</b>
              </span>
              <select
                value={contextId}
                onChange={(event) => {
                  setContextId(event.target.value);
                  setError('');
                }}
                disabled={loadingOptions}
                required
              >
                <option value="">
                  {loadingOptions
                    ? 'Loading choices…'
                    : `Select ${contextType === 'project' ? 'a project' : 'an activity'}`}
                </option>
                {(contextType === 'project' ? projects : activities).map((option) => (
                  <option key={option.id} value={option.id}>
                    {contextType === 'project' ? `${option.code} · ${option.name}` : option.name}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>

          {isSwitch && (
            <label className="work-start-task">
              <span className="work-start-label">
                Task description <b aria-hidden="true">*</b>
              </span>
              <textarea
                value={taskDescription}
                onChange={(event) => {
                  setTaskDescription(event.target.value);
                  setError('');
                }}
                placeholder="What task are you switching to?"
                rows="3"
                required
              />
              <small>Required when switching work context.</small>
            </label>
          )}

          {needsBos && (
            <label className="work-start-task">
              <span className="work-start-label">
                Start-of-day plan <b aria-hidden="true">*</b>
              </span>
              <textarea
                value={bosReport}
                onChange={(event) => {
                  setBosReport(event.target.value);
                  setError('');
                }}
                placeholder="What do you plan to accomplish today?"
                rows="4"
                required
              />
              <small>Required once, before {isDelegated ? `${subject.name}’s` : 'your'} first work session today.</small>
            </label>
          )}

          {error && <div className="work-start-error" role="alert">{error}</div>}

          <div className="work-start-footer">
            <div className="work-start-footer-copy">
              <span>
                {needsBos
                  ? `${isDelegated ? `${subject.name}’s` : 'Your'} workday plan and first session will be saved together.`
                  : isSwitch
                    ? 'Choose a different context and describe the new task.'
                    : isReopen
                      ? 'Your original check-in and start-of-day plan will be preserved.'
                      : 'Select exactly one work context to continue.'}
              </span>
              {!isSwitch && !isReopen && (
                <button
                  type="button"
                  className={`work-start-wfh${isWfh ? ' active' : ''}`}
                  aria-pressed={isWfh}
                  onClick={() => setIsWfh((current) => !current)}
                >
                  <i className={isWfh ? 'ri-home-heart-fill' : 'ri-home-4-line'} aria-hidden="true" />
                  {isWfh
                    ? 'WFH today'
                    : isDelegated ? `Mark ${subject.name} as WFH today` : 'Mark today as WFH'}
                  {isWfh && <i className="ri-check-line" aria-hidden="true" />}
                </button>
              )}
            </div>
            <button type="submit" className="work-start-submit" disabled={!canSubmit}>
              <i
                className={isSwitch ? 'ri-swap-line' : isReopen ? 'ri-restart-line' : 'ri-play-fill'}
                aria-hidden="true"
              />
              {submitting
                ? isSwitch ? 'Switching…' : isReopen ? 'Reopening…' : 'Starting…'
                : isSwitch ? 'Switch context' : isReopen ? 'Reopen day' : 'Start work'}
            </button>
          </div>
        </form>
      </section>
    </div>,
    document.body,
  );
};

export default WorkStartModal;
