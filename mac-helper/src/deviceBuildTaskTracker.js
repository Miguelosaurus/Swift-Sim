// @ts-check

/**
 * Register one lazily started task per key, or join the task already registered
 * under that key. Only the task that owns the current map entry may remove it.
 *
 * @template Build
 * @template Result
 * @param {Map<string, { build: Build, promise: Promise<Result> }>} activeTasks
 * @param {string} key
 * @param {Build} build
 * @param {() => Promise<Result> | Result} start
 * @returns {Promise<Result>}
 */
export function trackDeviceBuildTask(activeTasks, key, build, start) {
  const existing = activeTasks.get(key);
  if (existing) return existing.promise;

  const promise = Promise.resolve().then(start).finally(() => {
    if (activeTasks.get(key)?.promise === promise) activeTasks.delete(key);
  });
  activeTasks.set(key, { build, promise });
  return promise;
}
