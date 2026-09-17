const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// Missing values stay last in both directions; equal values keep source order.
export function compareSortValues(left, right, direction = 'asc') {
  const missing = (value) => value == null || value === '' || value === '—' || (typeof value === 'number' && !Number.isFinite(value));
  if (missing(left) || missing(right)) return Number(missing(left)) - Number(missing(right));
  const numeric = (value) => typeof value === 'number' || /^-?\d+(\.\d+)?$/.test(String(value).trim());
  const order = numeric(left) && numeric(right) ? Number(left) - Number(right) : collator.compare(String(left), String(right));
  return direction === 'desc' ? -order : order;
}

export function sortRows(rows, value, direction = 'asc') {
  return [...rows].sort((a, b) => compareSortValues(value(a), value(b), direction));
}
