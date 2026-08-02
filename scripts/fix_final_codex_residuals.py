from pathlib import Path


def replace_once(source: str, before: str, after: str, label: str) -> str:
    count = source.count(before)
    if count != 1:
        raise RuntimeError(f"Expected one {label} anchor, found {count}")
    return source.replace(before, after, 1)


live_path = Path("mac-helper/src/liveReload.js")
source = live_path.read_text()
source = replace_once(
    source,
    '    attributes.push(compact(source.slice(index, end)));\n',
    '    attributes.push(source.slice(index, end).trim());\n',
    "attribute surface normalization",
)

before_signing = '''export function expandedSigningIdentities(output) {
  const expanded = String(output || "")
    .match(/^\\s*EXPANDED_CODE_SIGN_IDENTITY\\s*=\\s*([A-F0-9]{40})\\s*$/m)?.[1] || "";
  return expanded ? [expanded] : [];
}

function resolveSigningIdentities(projectPath, scheme = "") {
  const containerArguments = xcodeContainerArguments(projectPath, scheme);
  const settings = spawnSync(
    "xcodebuild",
    [...containerArguments, "-configuration", "Debug", "-showBuildSettings"],
    { encoding: "utf8", timeout: 30_000 }
  );
  const output = String(settings.stdout || "");
  const expanded = expandedSigningIdentities(output);
  if (expanded.length > 0) return expanded;
  const team = output.match(/^\\s*DEVELOPMENT_TEAM\\s*=\\s*(\\S+)\\s*$/m)?.[1] || "";
'''
after_signing = '''export function selectLiveApplicationBuildSettings(output, scheme = "") {
  const collector = { sections: [], current: null, loose: {} };
  for (const line of String(output || "").split(/\\r?\\n/)) {
    const header = line.match(/^Build settings for action .* and target (.+):\\s*$/);
    if (header) {
      const section = { target: header[1].trim(), settings: {} };
      collector.sections.push(section);
      collector.current = section;
      continue;
    }
    const setting = line.match(/^\\s*([A-Z0-9_]+)\\s*=\\s*(.*)$/);
    if (!setting) continue;
    const destination = collector.current?.settings || collector.loose;
    destination[setting[1]] = setting[2].trim();
  }

  const normalizedScheme = String(scheme || "").trim();
  const candidates = collector.sections.filter(({ settings }) => {
    const productType = String(settings.PRODUCT_TYPE || "");
    return settings.WRAPPER_EXTENSION === "app"
      && !productType.includes("app-extension")
      && !productType.includes("unit-test")
      && !productType.includes("ui-testing");
  });
  const scored = candidates
    .map((section) => ({ section, score: liveApplicationSectionScore(section, normalizedScheme) }))
    .sort((left, right) => right.score - left.score || left.section.target.localeCompare(right.section.target));

  if (scored.length === 1 || (scored.length > 1 && scored[0].score > scored[1].score)) {
    return scored[0].section.settings;
  }
  if (scored.length > 1) {
    const hostApps = scored.filter(({ section }) =>
      section.settings.PRODUCT_TYPE === "com.apple.product-type.application"
    );
    if (hostApps.length === 1) return hostApps[0].section.settings;
    const names = scored.map(({ section }) => section.target).join(", ");
    throw new Error(
      `Xcode reported multiple equally likely application targets for live scheme ${normalizedScheme || "(unknown)"}: ${names}.`
    );
  }
  if (collector.sections.length > 0) {
    throw new Error(
      `Xcode did not report a host application target for live scheme ${normalizedScheme || "(unknown)"}.`
    );
  }
  return collector.loose;
}

function liveApplicationSectionScore({ target, settings }, scheme) {
  const productType = String(settings.PRODUCT_TYPE || "");
  let score = 0;
  if (target === scheme || settings.TARGET_NAME === scheme || settings.PRODUCT_NAME === scheme) score += 100;
  if (productType === "com.apple.product-type.application") score += 80;
  if (settings.SKIP_INSTALL !== "YES") score += 20;
  if (/iphoneos|iphonesimulator/.test(String(settings.SUPPORTED_PLATFORMS || ""))) score += 10;
  if (productType.includes("on-demand-install-capable")) score -= 80;
  if (productType.includes("watchapp")) score -= 80;
  if (productType.includes("messages")) score -= 60;
  return score;
}

function expandedSigningIdentitiesFromSettings(settings) {
  const expanded = String(settings?.EXPANDED_CODE_SIGN_IDENTITY || "").trim();
  return /^[A-F0-9]{40}$/.test(expanded) ? [expanded] : [];
}

export function expandedSigningIdentities(output, scheme = "") {
  return expandedSigningIdentitiesFromSettings(
    selectLiveApplicationBuildSettings(output, scheme),
  );
}

function resolveSigningIdentities(projectPath, scheme = "") {
  const containerArguments = xcodeContainerArguments(projectPath, scheme);
  const settings = spawnSync(
    "xcodebuild",
    [...containerArguments, "-configuration", "Debug", "-showBuildSettings"],
    { encoding: "utf8", timeout: 30_000 }
  );
  const output = String(settings.stdout || "");
  const selectedSettings = selectLiveApplicationBuildSettings(output, scheme);
  const expanded = expandedSigningIdentitiesFromSettings(selectedSettings);
  if (expanded.length > 0) return expanded;
  const team = String(selectedSettings.DEVELOPMENT_TEAM || "").trim();
'''
source = replace_once(source, before_signing, after_signing, "live signing settings selection")
live_path.write_text(source)


test_path = Path("test/mainPostMergeIntegration.test.js")
test_source = test_path.read_text()
if 'selectLiveApplicationBuildSettings,' not in test_source:
    test_source = test_source.replace(
        '  selectLiveScheme,\n',
        '  selectLiveApplicationBuildSettings,\n  selectLiveScheme,\n',
        1,
    )
if 'test("attribute string-literal whitespace requires a rebuild"' not in test_source:
    test_source += '''\n\ntest("attribute string-literal whitespace requires a rebuild", () => {
  const before = `struct Model {
  @Wrapper(value: "a b") var value: String
}`;
  const after = before.replace('"a b"', '"a  b"');
  const result = classifySwiftSource(before, after);
  assert.equal(result.hotReloadable, false);
  assert.equal(result.reasonCode, LIVE_REASON_CODES.DECLARATION_CHANGED);
});

test("live signing selects the host application section", () => {
  const extensionIdentity = "E".repeat(40);
  const appIdentity = "A".repeat(40);
  const output = `Build settings for action build and target ShareExtension:
    TARGET_NAME = ShareExtension
    PRODUCT_TYPE = com.apple.product-type.app-extension
    WRAPPER_EXTENSION = appex
    EXPANDED_CODE_SIGN_IDENTITY = ${extensionIdentity}
    DEVELOPMENT_TEAM = EXTTEAM
Build settings for action build and target App:
    TARGET_NAME = App
    PRODUCT_NAME = App
    PRODUCT_TYPE = com.apple.product-type.application
    WRAPPER_EXTENSION = app
    SKIP_INSTALL = NO
    SUPPORTED_PLATFORMS = iphoneos iphonesimulator
    EXPANDED_CODE_SIGN_IDENTITY = ${appIdentity}
    DEVELOPMENT_TEAM = APPTEAM`;
  assert.deepEqual(expandedSigningIdentities(output, "App"), [appIdentity]);
  assert.equal(selectLiveApplicationBuildSettings(output, "App").DEVELOPMENT_TEAM, "APPTEAM");
});

test("ambiguous live host application settings fail closed", () => {
  const output = `Build settings for action build and target First:
    PRODUCT_TYPE = com.apple.product-type.application
    WRAPPER_EXTENSION = app
    SKIP_INSTALL = NO
Build settings for action build and target Second:
    PRODUCT_TYPE = com.apple.product-type.application
    WRAPPER_EXTENSION = app
    SKIP_INSTALL = NO`;
  assert.throws(
    () => selectLiveApplicationBuildSettings(output, "Unknown"),
    /multiple equally likely application targets/,
  );
});
'''
test_path.write_text(test_source)
