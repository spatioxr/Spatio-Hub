export const ACTIVE_EMPLOYMENT_STATUS = 'Active';
export const ARCHIVED_EMPLOYMENT_STATUS = 'Released';

export const isActivePerson = (person) => person?.status === ACTIVE_EMPLOYMENT_STATUS;

export const isArchivedPerson = (person) => person?.status === ARCHIVED_EMPLOYMENT_STATUS;

export const employmentStatusLabel = (status) => (
  status === ARCHIVED_EMPLOYMENT_STATUS ? 'Archived' : status
);
