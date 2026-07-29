import { runRequiredBuildValidation } from "./buildValidation.js";
import { runDeviceBuild as runDeviceBuildCore } from "./deviceBuilderCore.js";

export * from "./deviceBuilderCore.js";

export async function runDeviceBuild(build, options = {}) {
  const save = () => options.save?.(build);
  try {
    build.state = "validating";
    save();
    await runRequiredBuildValidation({
      project: build.project || "",
      workspace: build.workspace || "",
      cancelPath: build.control?.cancelPath || "",
    });
    return await runDeviceBuildCore(build, options);
  } catch (error) {
    if (error?.code === "SWIFT_SIM_BUILD_CANCELLED") throw error;
    if (build.state === "validating") {
      build.state = "failed";
      build.logs = Array.isArray(build.logs) ? build.logs : [];
      build.logs.push(error instanceof Error ? error.message : String(error));
      save();
    }
    throw error;
  }
}
