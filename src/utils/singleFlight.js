export const createSingleFlight = () => {
  const active = new Map();

  return {
    run(key, operation) {
      if (active.has(key)) return active.get(key);
      const promise = Promise.resolve()
        .then(operation)
        .finally(() => {
          if (active.get(key) === promise) active.delete(key);
        });
      active.set(key, promise);
      return promise;
    },
    clear(key) {
      active.delete(key);
    },
    has(key) {
      return active.has(key);
    },
  };
};
