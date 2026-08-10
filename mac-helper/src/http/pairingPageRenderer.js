// @ts-check

import { buildPairingLinks } from "../links.js";

/** @param {{ pairing: Record<string, unknown>, base: string }} input */
export function renderPairingPage({ pairing, base }) {
  const links = buildPairingLinks(pairing, base);
  const customScheme = links.customScheme;
  const customSchemeScript = JSON.stringify(customScheme);
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Connect Swift Sim</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f8fbff; color: #121417; }
    main { max-width: 560px; margin: 0 auto; padding: 40px 22px; }
    a.button { display: inline-block; margin-top: 18px; padding: 14px 18px; border-radius: 999px; color: white; background: #1677ff; text-decoration: none; font-weight: 700; }
    code { display: block; margin-top: 18px; padding: 14px; border-radius: 14px; background: white; word-break: break-all; }
  </style>
  <script>
    window.addEventListener("load", () => {
      setTimeout(() => { window.location.href = ${customSchemeScript}; }, 250);
    });
  </script>
</head>
<body>
  <main>
    <h1>Pair with ${escapeHtml(pairing.macName || "this Mac")}</h1>
    <p>Swift Sim will verify this Mac before saving it and open the Mac Connection screen automatically.</p>
    <p>Both devices need internet access and the same Tailnet, but not the same Wi-Fi network or a USB cable.</p>
    <a class="button" href="${escapeHtml(customScheme)}">Pair in Swift Sim</a>
    <p>If Swift Sim does not open automatically, tap the button or paste this link in the app:</p>
    <code>${escapeHtml(customScheme)}</code>
  </main>
</body>
</html>`;
}

/** @param {unknown} value */
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}
