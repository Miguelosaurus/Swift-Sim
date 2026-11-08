const ACTIVE = new Set([
  "PREPARING",
  "WAITING_FOR_APP",
  "APPLYING",
  "INSTALL_QUEUED",
  "CONFIRM_INSTALL",
  "INSTALL_CONFIRMING",
]);
const opaque = (v) => typeof v === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(v);
export function deliveryPresentationForEvent(event) {
  let code = "STATUS_UNAVAILABLE",
    nextAction = "check-status",
    complete = false;
  if (event.kind === "live-applied") {
    code = "CHANGES_APPLIED";
    nextAction = "none";
    complete = true;
  } else if (event.kind === "launch-confirmed" || event.deliveryCode === "BUILD_INSTALLED") {
    code = "BUILD_INSTALLED";
    nextAction = "none";
    complete = true;
  } else if (event.deliveryCode) {
    code = event.deliveryCode;
    nextAction = event.deliveryAction || "check-status";
  } else if (event.kind === "build-ready") {
    code = "READY_TO_INSTALL";
    nextAction = "open-swift-sim";
  } else if (event.kind === "attention") {
    code =
      event.state === "uncertain"
        ? "UNCONFIRMED"
        : event.state.startsWith("LIVE_")
          ? "CHECK_MAC"
          : "NEEDS_ATTENTION";
    nextAction = code === "CHECK_MAC" ? "check-mac" : "check-status";
  } else if (["expired", "superseded", "unavailable"].includes(event.state)) {
    code =
      event.state === "expired"
        ? "EXPIRED"
        : event.state === "superseded"
          ? "SUPERSEDED"
          : "STATUS_UNAVAILABLE";
  } else if (["waiting-for-device", "waiting-for-foreground"].includes(event.state)) {
    code = "WAITING_FOR_APP";
    nextAction = "open-app";
  } else if (["applying", "applied"].includes(event.state)) {
    code = "APPLYING";
    nextAction = "wait";
  } else {
    code = "PREPARING";
    nextAction = "wait";
  }
  return {
    schemaVersion: 1,
    code,
    title: event.title,
    message: event.message,
    nextAction,
    completionVerified: complete,
    updatedAt: new Date(event.time).toISOString(),
    ...(opaque(event.buildId) ? { buildId: event.buildId } : {}),
    ...(opaque(event.requestId) ? { requestId: event.requestId } : {}),
    ...(event.revision ? { revision: event.revision } : {}),
  };
}
export function selectDeliveryPresentations(events) {
  const apps = new Map();
  for (const event of events) {
    if (!opaque(event.appId) || !Number.isFinite(event.intentAt)) continue;
    if (!apps.has(event.appId)) apps.set(event.appId, new Map());
    const key = event.requestId || event.buildId;
    if (!opaque(key)) continue;
    const group = apps.get(event.appId),
      previous = group.get(key),
      presentation = deliveryPresentationForEvent(event);
    if (
      !previous ||
      presentation.completionVerified ||
      (!previous.presentation.completionVerified && event.time >= previous.time)
    )
      group.set(key, { presentation, intentAt: event.intentAt, time: event.time });
  }
  const result = Object.create(null);
  for (const [id, group] of [...apps].slice(0, 128)) {
    const values = [...group.values()].sort((a, b) => b.intentAt - a.intentAt || b.time - a.time);
    const uncertain = values.find((v) => v.presentation.code === "UNCONFIRMED");
    const active = values.filter((v) => ACTIVE.has(v.presentation.code));
    let selected = uncertain || values[0];
    if (!selected) continue;
    if (!uncertain && active.length > 1)
      selected = {
        ...selected,
        presentation: {
          ...selected.presentation,
          code: "MULTIPLE_PENDING",
          title: "Check pending updates",
          message:
            "More than one update is pending for this app. Ask your agent to check the existing requests.",
          nextAction: "check-status",
          completionVerified: false,
        },
      };
    result[id] = selected.presentation;
  }
  return result;
}
