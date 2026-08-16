export const createKeyedQueue = () => {
  const pending = new Map();
  const enqueue = (key, operation) => {
    const previous = pending.get(key) || Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    pending.set(key, current);
    current.finally(() => {
      if (pending.get(key) === current) pending.delete(key);
    }).catch(() => undefined);
    return current;
  };
  const drain = async () => {
    while (pending.size) await Promise.allSettled([...pending.values()]);
  };
  return { enqueue, drain, size: () => pending.size };
};
