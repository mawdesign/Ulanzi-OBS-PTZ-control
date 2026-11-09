/** A controllable clock for the service's reconnect scheduling. Nothing fires until the test says so. */
export function fakeTimers() {
  let nextId = 1;
  const pending = new Map(); // id -> { fn, ms }
  const delays = []; // every delay ever scheduled, in order
  return {
    timers: {
      setTimeout(fn, ms) {
        const id = nextId++;
        pending.set(id, { fn, ms });
        delays.push(ms);
        return id;
      },
      clearTimeout(id) {
        pending.delete(id);
      },
    },
    delays,
    get pendingCount() {
      return pending.size;
    },
    /** Run the oldest pending timer. Returns false if none was pending. */
    fire() {
      const first = pending.keys().next();
      if (first.done) return false;
      const { fn } = pending.get(first.value);
      pending.delete(first.value);
      fn();
      return true;
    },
  };
}
