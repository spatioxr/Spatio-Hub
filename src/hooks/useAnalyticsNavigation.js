import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ANALYTICS_FILTER_KEYS,
  readAnalyticsView,
  writeAnalyticsView,
} from '../utils/analyticsNavigation';

const readSavedSearch = (storageKey) => {
  try {
    return sessionStorage.getItem(storageKey) || '';
  } catch {
    return '';
  }
};

export default function useAnalyticsNavigation(userId, today) {
  const [searchParams, setSearchParams] = useSearchParams();
  const storageKey = `analytics-view:${userId}`;
  const savedSearch = readSavedSearch(storageKey);
  const search = searchParams.toString();
  const view = useMemo(() => {
    const params = new URLSearchParams(search);
    const hasView = ['start', 'end', ...ANALYTICS_FILTER_KEYS].some((key) => params.has(key));
    return readAnalyticsView(hasView ? search : savedSearch, today);
  }, [search, savedSearch, today]);
  const { start, end } = view.range;
  // Filter changes should not trigger another reporting-period fetch.
  const range = useMemo(() => ({ start, end }), [start, end]);

  useEffect(() => {
    const canonical = writeAnalyticsView(search, view).toString();
    try {
      sessionStorage.setItem(storageKey, canonical);
    } catch {
      // URL navigation still works when browser storage is unavailable.
    }
    if (search !== canonical) setSearchParams(canonical, { replace: true });
  }, [search, view, storageKey, setSearchParams]);

  const updateView = (next) => {
    const params = writeAnalyticsView(search, { ...view, ...next });
    if (params.toString() !== search) setSearchParams(params);
  };

  return { range, filters: view.filters, updateView };
}
