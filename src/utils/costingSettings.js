export const DEFAULT_COSTING_HOURS = 176;
// Highest ID wins when more than one revision has the same effective month.
export const latestCostingBaselines = (history) => [...history].sort((a, b) => (
  b.effective_month.localeCompare(a.effective_month)
  || String(b.id).localeCompare(String(a.id), undefined, { numeric: true })
)).filter((entry, index, rows) => index === 0 || entry.effective_month !== rows[index - 1].effective_month);
export const effectiveCostingBaseline = (history, month) => (
  latestCostingBaselines(history).find((entry) => entry.effective_month.slice(0, 7) <= month)
  || { monthly_hours: DEFAULT_COSTING_HOURS, effective_month: null }
);
