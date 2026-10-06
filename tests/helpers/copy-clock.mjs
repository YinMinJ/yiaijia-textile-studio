export function copyClock() {
  let now = 0, nextId = 0;
  const pending = new Map();
  const clock = {
    get now() { return now; },
    setTimeout(callback, delay) {
      const id = ++nextId;
      pending.set(id, { at: now + delay, callback });
      return id;
    },
    clearTimeout(id) { pending.delete(id); },
    advance(milliseconds) {
      const target = now + milliseconds;
      for (;;) {
        const next = [...pending].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at;
        pending.delete(next[0]);
        next[1].callback();
      }
      now = target;
    },
    timeout(milliseconds) {
      const controller = new AbortController();
      clock.setTimeout(() => controller.abort(new DOMException("Test deadline exceeded", "TimeoutError")), milliseconds);
      return controller.signal;
    },
  };
  return clock;
}
