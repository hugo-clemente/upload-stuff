/**
 * Merge several `HeadersInit`s into a plain object, later sources overriding
 * earlier ones (so per-call `runOpts.headers` win over helper-level
 * `opts.headers`). `undefined` sources are skipped. Used to attach the
 * consumer's auth/identity headers to both the init and complete requests.
 */
export const mergeHeaders = (...inits: Array<HeadersInit | undefined>): Record<string, string> => {
  const out = new Headers();
  for (const init of inits) {
    if (!init) continue;
    new Headers(init).forEach((value, key) => out.set(key, value));
  }
  return Object.fromEntries(out.entries());
};
