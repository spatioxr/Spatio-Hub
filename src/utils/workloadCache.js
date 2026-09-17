// Memory only: short-lived snapshots never enter browser storage.
export const createWorkloadCache = ({ ttl = 30000, now = Date.now } = {}) => {
  let owner = null;
  const values = new Map();
  const scope = (nextOwner) => {
    if (owner !== nextOwner) { values.clear(); owner = nextOwner; }
  };
  return {
    get(nextOwner, key) {
      scope(nextOwner);
      const item = values.get(key);
      if (!item || now() - item.time >= ttl) { values.delete(key); return null; }
      return item.value;
    },
    set(nextOwner, key, value) {
      scope(nextOwner);
      values.delete(key);
      values.set(key, { value, time: now() });
      if (values.size > 6) values.delete(values.keys().next().value);
    },
    clear() { values.clear(); owner = null; },
  };
};

export const workloadCache = createWorkloadCache();
