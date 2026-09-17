export const checkInRequirements = (settings) => ({
  bos_required: settings?.bos_required ?? true,
  eod_required: settings?.eod_required ?? true,
});
export const hasCheckInException = (settings) => {
  const value = checkInRequirements(settings);
  return !value.bos_required || !value.eod_required;
};
export const checkInSettingsChanged = (saved, draft) => {
  const current = checkInRequirements(saved);
  return current.bos_required !== draft.bos_required || current.eod_required !== draft.eod_required;
};
