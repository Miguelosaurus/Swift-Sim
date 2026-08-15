// @ts-check

import { PHASE4_AUTHORITY_MODES } from "./sqlitePhase4AuthorityRepository.js";

/**
 * Reads the product-global authority selector exactly once for each operation,
 * then calls exactly one backend. Backend failures are deliberately allowed to
 * propagate; there is no fallback, merge, or dual-write path.
 */
export class Phase4AuthorityRouter {
  #authorityRepository;

  /** @param {{ getState(): { mode: string } }} authorityRepository */
  constructor(authorityRepository) {
    if (!authorityRepository || typeof authorityRepository.getState !== "function") {
      throw new TypeError("Phase-4 authority router requires an authority repository.");
    }
    this.#authorityRepository = authorityRepository;
  }

  current() {
    return this.#authorityRepository.getState();
  }

  /** @template T @param {{ legacy: () => T, sqlite: () => T }} backends @returns {T} */
  read(backends) {
    return this.#route(backends);
  }

  /** @template T @param {{ legacy: () => T, sqlite: () => T }} backends @returns {T} */
  write(backends) {
    return this.#route(backends);
  }

  /** @template T @param {{ legacy: () => T, sqlite: () => T }} backends @returns {T} */
  #route(backends) {
    if (typeof backends?.legacy !== "function" || typeof backends?.sqlite !== "function") {
      throw new TypeError("Phase-4 authority routing requires legacy and SQLite backends.");
    }
    const state = this.#authorityRepository.getState();
    if ([PHASE4_AUTHORITY_MODES.legacy, PHASE4_AUTHORITY_MODES.preparing].includes(state.mode)) {
      return backends.legacy();
    }
    if (
      [
        PHASE4_AUTHORITY_MODES.sqliteRollback,
        PHASE4_AUTHORITY_MODES.rollbackPreparing,
        PHASE4_AUTHORITY_MODES.sqliteFinal,
      ].includes(state.mode)
    ) {
      return backends.sqlite();
    }
    throw new Error(`Unsupported Phase-4 authority mode ${state.mode}.`);
  }
}

/**
 * Small method-level facade used by product stores. Methods are resolved lazily
 * so constructing an authority-routed facade never initializes or mutates the
 * inactive backend.
 *
 * @param {{
 *  router: Phase4AuthorityRouter,
 *  legacy: () => Record<string, unknown>,
 *  sqlite: () => Record<string, unknown>,
 * }} input
 */
export function createAuthorityRoutedFacade({ router, legacy, sqlite }) {
  let legacyInstance;
  let sqliteInstance;
  const loadLegacy = () => (legacyInstance ??= legacy());
  const loadSqlite = () => (sqliteInstance ??= sqlite());
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "phase4AuthorityState") return () => router.current();
        if (property === Symbol.toStringTag) return "Phase4AuthorityRoutedFacade";
        return (...args) =>
          router.read({
            legacy: () => callMethod(loadLegacy(), property, args),
            sqlite: () => callMethod(loadSqlite(), property, args),
          });
      },
    },
  );
}

/** @param {Record<string, unknown>} backend @param {string | symbol} property @param {unknown[]} args */
function callMethod(backend, property, args) {
  const method = Reflect.get(backend, property);
  if (typeof method !== "function") {
    throw new TypeError(`Selected Phase-4 backend does not implement ${String(property)}.`);
  }
  return method.apply(backend, args);
}
