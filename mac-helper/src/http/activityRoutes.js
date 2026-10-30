import { badRequest, json, notFound, readJson, unauthorized } from "../http.js";

export const activityAuthorizationMatrix = Object.freeze([
  { route: "GET /api/activity", exposure: "private-helper", authorization: "paired-mac" },
  { route: "POST /api/activity/device", exposure: "private-helper", authorization: "paired-mac" },
  {
    route: "DELETE /api/activity/device/:id",
    exposure: "private-helper",
    authorization: "paired-mac",
  },
]);

export async function handleActivityRoutes({
  req,
  res,
  url,
  service,
  authorize,
  privateHelper = false,
} = {}) {
  const isFeed = req.method === "GET" && url.pathname === "/api/activity";
  const isRegister = req.method === "POST" && url.pathname === "/api/activity/device";
  const remove =
    req.method === "DELETE" && url.pathname.match(/^\/api\/activity\/device\/([^/]+)$/);
  if (!isFeed && !isRegister && !remove) return false;
  if (!privateHelper) {
    notFound(res);
    return true;
  }
  const authorized = async () => {
    try {
      return typeof authorize === "function" && Boolean(await authorize(req, url));
    } catch {
      return false;
    }
  };
  if (!(await authorized())) {
    unauthorized(res);
    return true;
  }
  try {
    if (isFeed) {
      const raw = url.searchParams.get("after") || "0";
      if (!/^\d{1,16}$/.test(raw)) throw new Error("Invalid activity cursor.");
      await service.refresh?.();
      if (!(await authorized())) {
        unauthorized(res);
        return true;
      }
      json(
        res,
        200,
        service.feed({
          after: Number(raw),
          deviceId: url.searchParams.get("deviceId") || undefined,
        }),
      );
    } else if (isRegister) {
      const body = await readJson(req, { maxBytes: 16 * 1024 });
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).some(
          (key) => !["deviceId", "token", "environment", "preferences"].includes(key),
        )
      )
        throw new Error("Invalid notification registration.");
      // Recheck pairing after asynchronous body delivery: an already rotated
      // credential must never register a device in the replacement authority.
      if (!(await authorized())) {
        unauthorized(res);
        return true;
      }
      json(res, 200, await service.registerDevice(body));
    } else {
      if (!(await authorized())) {
        unauthorized(res);
        return true;
      }
      json(res, 200, await service.unregisterDevice(remove[1]));
    }
  } catch {
    badRequest(res, 400, "The activity request is invalid or could not be completed.");
  }
  return true;
}
