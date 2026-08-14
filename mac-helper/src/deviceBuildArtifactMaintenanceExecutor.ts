import { NodeArtifactStore } from "./infrastructure/nodeArtifactStore.js";

export interface DeviceBuildArtifactDeletionStore {
  resolveContained(root: string, candidate: string): string;
  removeTree(path: string): Promise<void>;
}

/**
 * Explicit historical-maintenance executor. The adapter delegates destructive
 * reclamation only to the existing contained ArtifactStore boundary; it owns no
 * startup/background scheduling and imports no raw recursive filesystem delete.
 */
export function createDeviceBuildArtifactMaintenanceExecutor(
  artifactStore: DeviceBuildArtifactDeletionStore = new NodeArtifactStore(),
) {
  return Object.freeze({
    approveContained(root: string, candidate: string): string {
      return artifactStore.resolveContained(root, candidate);
    },
    async reclaimApproved(path: string): Promise<void> {
      await artifactStore.removeTree(path);
    },
  });
}
