import { useSearchParams } from 'react-router-dom';
import { sortRows } from '../utils/sorting';

export default function useListSort(id, options, defaultKey = options[0].key, defaultDirection = 'asc') {
  const [params, setParams] = useSearchParams();
  const key = options.some((option) => option.key === params.get(`${id}Sort`)) ? params.get(`${id}Sort`) : defaultKey;
  const rawDirection = params.get(`${id}Direction`);
  const direction = ['asc', 'desc'].includes(rawDirection) ? rawDirection : defaultDirection;
  const option = options.find((item) => item.key === key);
  const update = (nextKey, nextDirection) => setParams((current) => {
    const next = new URLSearchParams(current);
    next.set(`${id}Sort`, nextKey);
    next.set(`${id}Direction`, nextDirection);
    return next;
  }, { replace: true });
  return { key, direction, options, update, sort: (rows) => sortRows(rows, option.value, direction) };
}
