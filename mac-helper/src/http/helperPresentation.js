// @ts-check

/** @typedef {{ customScheme: string }} CompanionLinks */
/** @typedef {{ customScheme: string, installURL?: string }} DeviceBuildLinks */
/** @typedef {{
 *   state: string,
 *   scheme?: string,
 *   expiresAt: string,
 *   app: { name?: string, bundleIdentifier?: string },
 *   signing: { warnings?: string[] },
 * }} DeviceBuildPresentation */

/** @param {CompanionLinks} links */
export function renderSessionFallbackPage(links) {
  const customSchemeScript = JSON.stringify(links.customScheme);
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Swift Sim Session</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #fbfcff; color: #0f1115; }
    main { width: min(480px, calc(100vw - 36px)); padding: 28px; border-radius: 34px; background: rgba(255,255,255,.82); box-shadow: 0 24px 70px rgba(31,44,64,.12); border: 1px solid rgba(20,30,45,.08); }
    .status { display: inline-flex; align-items: center; gap: 8px; color: #65707c; font-size: 15px; font-weight: 700; }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: #34c759; display: inline-block; }
    h1 { margin: 12px 0 8px; font-size: 34px; line-height: 1.04; }
    p { color: #626b76; font-size: 17px; line-height: 1.4; }
    a.button { display: block; margin-top: 18px; padding: 16px 18px; border-radius: 999px; color: white; background: #1683ff; text-align: center; text-decoration: none; font-weight: 800; }
    code { display: block; margin-top: 16px; padding: 14px; border-radius: 18px; background: rgba(128,128,128,.12); color: #5b6570; word-break: break-all; font-size: 13px; }
  </style>
  <script>
    window.addEventListener("load", () => {
      setTimeout(() => { window.location.href = ${customSchemeScript}; }, 250);
    });
  </script>
</head>
<body>
  <main>
    <div class="status"><span class="dot"></span>Opening Swift Sim</div>
    <h1>Swift Sim</h1>
    <p>This page opens the live Simulator in the Swift Sim app.</p>
    <a class="button" href="${escapeHtml(links.customScheme)}">Open in Swift Sim</a>
    <p>If that button does not switch apps, paste this link into Swift Sim:</p>
    <code>${escapeHtml(links.customScheme)}</code>
  </main>
</body>
</html>`;
}

/** @param {{ build: DeviceBuildPresentation, links: DeviceBuildLinks }} input */
export function renderDeviceBuildFallbackPage({ build, links }) {
  const installURL = links.installURL || "#";
  const customSchemeScript = JSON.stringify(links.customScheme);
  const warnings = (build.signing.warnings || [])
    .map((warning) => `<li>${escapeHtml(warning)}</li>`)
    .join("");
  const stateLine =
    build.state === "ready"
      ? "Ready to install on this iPhone"
      : build.state === "failed"
        ? "Build failed"
        : "Build is still running";
  void stateLine;
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Install ${escapeHtml(build.app.name || build.scheme || "iOS App")}</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f7fbff; color: #101318; }
    main { width: min(520px, calc(100vw - 34px)); padding: 28px; border-radius: 34px; background: rgba(255,255,255,.86); box-shadow: 0 24px 70px rgba(31,44,64,.13); border: 1px solid rgba(20,30,45,.08); }
    .status { display: inline-flex; align-items: center; gap: 8px; color: #65707c; font-size: 15px; font-weight: 750; }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: ${build.state === "ready" ? "#34c759" : build.state === "failed" ? "#ff3b30" : "#ffcc00"}; display: inline-block; }
    h1 { margin: 14px 0 8px; font-size: 34px; line-height: 1.04; letter-spacing: 0; }
    p { color: #626b76; font-size: 17px; line-height: 1.4; }
    .meta { margin: 16px 0 0; padding: 14px; border-radius: 18px; background: rgba(118,142,170,.1); color: #4c5864; font-size: 14px; }
    a.button { display: block; margin-top: 18px; padding: 16px 18px; border-radius: 999px; color: white; background: ${build.state === "ready" ? "#1683ff" : "#8f98a3"}; text-align: center; text-decoration: none; font-weight: 850; pointer-events: ${build.state === "ready" ? "auto" : "none"}; }
    a.secondary { display: block; margin-top: 16px; color: #66717d; text-align: center; text-decoration: none; font-size: 14px; font-weight: 700; }
    .fallback { margin-top: 10px; color: #7a838d; text-align: center; font-size: 13px; }
    ul { margin: 12px 0 0; padding-left: 20px; color: #6b7280; font-size: 14px; line-height: 1.35; }
    code { word-break: break-all; }
  </style>
  <script>
    window.addEventListener("load", () => {
      setTimeout(() => { window.location.href = ${customSchemeScript}; }, 250);
    });
  </script>
</head>
<body>
  <main>
    <div class="status"><span class="dot"></span>Opening Swift Sim</div>
    <h1>${escapeHtml(build.app.name || build.scheme || "iOS App")}</h1>
    <p>Swift Sim saves this version, then opens the iOS install prompt. Updates normally keep your login and app data.</p>
    <div class="meta">
      <strong>App ID: ${escapeHtml(build.app.bundleIdentifier || "Not available")}</strong><br>
      Link expires ${escapeHtml(new Date(build.expiresAt).toLocaleString())}
    </div>
    ${warnings ? `<ul>${warnings}</ul>` : ""}
    <a class="button" href="${escapeHtml(links.customScheme)}">Open in Swift Sim</a>
    <a class="secondary" href="${escapeHtml(installURL)}">Install directly</a>
    <div class="fallback">Installing directly will not save this version in Swift Sim.</div>
  </main>
</body>
</html>`;
}

/** @param {string} appId */
export function appleAppSiteAssociation(appId) {
  return {
    applinks: {
      apps: [],
      details: [
        {
          appIDs: [appId],
          components: [
            {
              "/": "/s/*",
              comment: "Open Swift Sim companion sessions.",
            },
            {
              "/": "/pair",
              comment: "Pair Swift Sim companion with this Mac helper.",
            },
            {
              "/": "/d/*",
              comment: "Open Swift Sim device build installs.",
            },
          ],
        },
      ],
    },
  };
}

/** @param {unknown} value */
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const replacements = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return replacements[/** @type {keyof typeof replacements} */ (char)];
  });
}
