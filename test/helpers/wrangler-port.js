// Port allocation for `wrangler dev` in tests. Wrangler binds an OS-assigned port itself (`--port 0`,
// `--inspector-port 0`) and prints the real URL; tests read it from the log. This replaces probing a "free"
// port, closing it and letting wrangler bind it later — a check-then-bind race that flaked CI with
// "bind(): Address already in use" when another workerd took the port in between.
export const PORT_ARGS = Object.freeze(['--ip', '127.0.0.1', '--port', '0', '--inspector-port', '0']);
/** @param {string} logs @returns {string|null} the worker's base URL once wrangler reports it is ready */
export function readyBase(logs) {
  const match = /Ready on (http:\/\/127\.0\.0\.1:\d+)/.exec(String(logs).replace(/\u001b\[[0-9;]*m/g, ''));
  return match ? match[1] : null;
}
