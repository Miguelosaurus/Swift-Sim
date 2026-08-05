export interface SchemaMigration {
  version: number;
  name: string;
  statements: readonly string[];
  requiredTables: readonly string[];
}

export interface RepositoryHealth {
  ok: boolean;
  path: string;
  integrity: string;
  journalMode: string;
  foreignKeys: boolean;
  foreignKeyViolations: number;
  missingTables: readonly string[];
  schemaVersion: number;
  latestSchemaVersion: number;
  migrationsApplied: number;
}

export interface SynchronousRepositoryTransaction {
  transaction<T>(operation: () => T): T;
}

/**
 * Records the exact legacy projection that has been imported and compared.
 * Domain cutover code may safely retry the same source because `source` is
 * unique and updates replace the prior evidence atomically.
 */
export interface LegacyImportCheckpoint {
  source: string;
  sourceRevision: string;
  projectionHash: string;
  importedAt: string;
  recordCount: number;
}

export interface LegacyImportCheckpointRepository extends SynchronousRepositoryTransaction {
  get(source: string): LegacyImportCheckpoint | null;
  list(): LegacyImportCheckpoint[];
  upsert(checkpoint: LegacyImportCheckpoint): void;
}
