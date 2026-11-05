// Loaded only by an explicit testing command or authenticated testing route.
import { parseArgs } from "node:util";
import { createApnsProvider } from "../../src/apnsProvider.js";
import { createActivityStore } from "../../src/activityStore.js";
import { runAppControlCli } from "../../src/appControlCli.js";
import { badRequest, json, notFound, readJson, unauthorized } from "../../src/http.js";

export function createTestingRequests({
  authority,
  builds,
  run,
  lockManager,
  notificationStore = createActivityStore({ lockManager }),
  provider = createApnsProvider(),
} = {}) {
  async function worker(args, scope = authority()) {
    let result;
    await runAppControlCli([...args, "--authority", scope.epoch], {
      run,
      internalWorker: true,
      write: (line) => {
        result = JSON.parse(line);
      },
    });
    if (authority().epoch !== scope.epoch) throw Error("Testing pairing changed.");
    return result;
  }
  return {
    async command(args) {
      const [command, ...rest] = args;
      const { values } = parseArgs({
        args: rest,
        options: {
          app: { type: "string" },
          request: { type: "string" },
          minutes: { type: "string" },
          "notification-device": { type: "string" },
        },
      });
      if (command === "open") {
        if (!values.request || !values.app)
          throw Error("Select the approved testing request and app.");
        return worker([
          "open",
          "--app",
          values.app,
          "--request",
          values.request,
          ...(values.minutes ? ["--minutes", values.minutes] : []),
        ]);
      }
      if (command === "status" || command === "cancel-request") {
        if (!values.request) throw Error("Select this task's testing request.");
        return worker([
          command === "status" ? "request-get" : "request-cancel",
          "--request",
          values.request,
        ]);
      }
      if (command !== "request" || !values.app) throw Error("Select an app for testing.");
      const scope = authority();
      const candidates = builds()
        .filter((build) => build.state === "ready" && build.app?.bundleIdentifier === values.app)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      const build = candidates[0];
      if (!build) throw Error("Use an app already connected to Swift Sim.");
      const registered = notificationStore.snapshot();
      const devices = registered.devices.filter(
        (device) =>
          device.epoch === scope.epoch &&
          device.enabled &&
          device.token &&
          (!values["notification-device"] || device.id === values["notification-device"]),
      );
      if (devices.length !== 1)
        return {
          schemaVersion: 1,
          outcome: "needs-user-action",
          code: "APP_CONTROL_NOTIFICATION_DEVICE_REQUIRED",
          guidance:
            "Open Swift Sim on the selected iPhone to register notifications. With multiple phones, select its notification registration explicitly.",
        };
      const created = await worker(
        [
          "request-create",
          "--app",
          values.app,
          "--name",
          build.app.name || values.app,
          "--audience",
          devices[0].id,
        ],
        scope,
      );
      if (created.outcome === "needs-user-action") return created;
      const request = created.request;
      const status = provider.status();
      const sent = await provider.send({
        token: devices[0].token,
        environment: devices[0].environment,
        apnsId: request.id,
        collapseId: request.id,
        expectedGeneration: status.generation,
        isCurrent: async () => {
          if (authority().epoch !== scope.epoch) return false;
          const current = await worker(["request-get", "--request", request.id], scope);
          return current.outcome === "request-pending";
        },
        payload: {
          aps: {
            category: "SWIFT_SIM_APP_TESTING",
            alert: {
              title: `Test ${request.name}`,
              body: "Your agent is ready. Tap to allow app testing for up to 10 minutes.",
            },
            sound: "default",
          },
          appTestingRequestId: request.id,
          macID: scope.installationId,
        },
      });
      return {
        schemaVersion: 1,
        outcome: "waiting-for-phone",
        request: request.id,
        expiresAt: request.expiresAt,
        notificationState: sent.state,
        guidance:
          "Allow the request in Swift Sim. Notification acceptance is not delivery or approval.",
      };
    },
    async get(id, app, audience) {
      return worker([
        "request-get",
        ...(id ? ["--request", id] : []),
        ...(app ? ["--app", app] : []),
        ...(audience ? ["--audience", audience] : []),
      ]);
    },
    async approve(id, deviceId) {
      return worker(["request-approve", "--request", id, "--audience", deviceId]);
    },
    async cancel(id, deviceId) {
      return worker(["request-cancel", "--request", id, "--audience", deviceId]);
    },
  };
}

export async function handleTestingRequestRoutes({
  req,
  res,
  url,
  authorize,
  service,
  privateHelper,
  installationId,
}) {
  if (!privateHelper) {
    notFound(res);
    return;
  }
  const authorized = async () => {
    try {
      return Boolean(await authorize(req, url));
    } catch {
      return false;
    }
  };
  if (!(await authorized())) {
    unauthorized(res);
    return;
  }
  const match = url.pathname.match(/^\/api\/app-testing\/([a-f0-9-]{36}|pending)$/);
  if (!match || !["GET", "POST"].includes(req.method)) {
    notFound(res);
    return;
  }
  try {
    let result;
    if (req.method === "GET") {
      result = await service.get(
        match[1] === "pending" ? null : match[1],
        url.searchParams.get("app"),
        url.searchParams.get("deviceId"),
      );
      if (result.code === "APP_CONTROL_REQUEST_REQUIRED")
        result = { schemaVersion: 1, outcome: "no-pending-request" };
    } else {
      const body = await readJson(req, { maxBytes: 2048 });
      if (
        !body ||
        Object.keys(body).some((key) => !["deviceId", "action"].includes(key)) ||
        typeof body.deviceId !== "string" ||
        body.deviceId.length > 64 ||
        !["approve", "cancel"].includes(body.action) ||
        match[1] === "pending"
      )
        throw Error("Invalid testing approval.");
      if (!(await authorized())) {
        unauthorized(res);
        return;
      }
      result = await service[body.action](match[1], body.deviceId);
    }
    if (!(await authorized())) {
      unauthorized(res);
      return;
    }
    json(res, result.outcome === "needs-user-action" ? 409 : 200, {
      ...result,
      macID: installationId(),
    });
  } catch {
    badRequest(res, 400, "This testing request could not be verified. No app input was sent.");
  }
}
