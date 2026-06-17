import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

export class SimulatorProfileResolver {
  constructor({ run = defaultRun } = {}) {
    this.run = run;
    this.cache = new Map();
  }

  resolve(simulatorUDID) {
    if (this.cache.has(simulatorUDID)) return this.cache.get(simulatorUDID);

    const devices = JSON.parse(this.run("xcrun", ["simctl", "list", "devices", "-j"]));
    const device = Object.values(devices.devices || {})
      .flat()
      .find((candidate) => candidate.udid === simulatorUDID);
    if (!device?.deviceTypeIdentifier) return null;

    const deviceTypes = JSON.parse(this.run("xcrun", ["simctl", "list", "devicetypes", "-j"]));
    const deviceType = (deviceTypes.devicetypes || [])
      .find((candidate) => candidate.identifier === device.deviceTypeIdentifier);
    if (!deviceType?.bundlePath) return null;

    const profilePath = join(deviceType.bundlePath, "Contents", "Resources", "profile.plist");
    const profile = JSON.parse(this.run("plutil", ["-convert", "json", "-o", "-", profilePath]));
    if (!profile.framebufferMask) return null;

    const resourcesPath = resolve(deviceType.bundlePath, "Contents", "Resources");
    const maskPath = resolve(resourcesPath, `${profile.framebufferMask}.pdf`);
    if (!maskPath.startsWith(`${resourcesPath}${sep}`) || !existsSync(maskPath)) return null;

    const result = {
      deviceName: device.name || deviceType.name || "Simulator",
      modelIdentifier: deviceType.modelIdentifier || profile.modelIdentifier || "",
      width: Number(profile.mainScreenWidth || 0),
      height: Number(profile.mainScreenHeight || 0),
      maskPath,
      contentType: "application/pdf",
    };
    this.cache.set(simulatorUDID, result);
    return result;
  }

  readMask(simulatorUDID) {
    const profile = this.resolve(simulatorUDID);
    if (!profile) return null;
    return {
      ...profile,
      data: readFileSync(profile.maskPath),
    };
  }
}

function defaultRun(command, args) {
  return execFileSync(command, args, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
}
