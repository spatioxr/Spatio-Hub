const defaultKey = (item) => item?.id;

export const getSequenceNavigation = (items, selectedKey, keyForItem = defaultKey) => {
  const sequence = Array.isArray(items) ? items : [];
  const index = sequence.findIndex((item) => keyForItem(item) === selectedKey);

  return {
    current: index >= 0 ? sequence[index] : null,
    previous: index > 0 ? sequence[index - 1] : null,
    next: index >= 0 && index < sequence.length - 1 ? sequence[index + 1] : null,
    index,
    position: index >= 0 ? index + 1 : 0,
    total: sequence.length,
  };
};
