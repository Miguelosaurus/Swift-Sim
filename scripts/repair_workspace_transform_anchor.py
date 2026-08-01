from pathlib import Path

path = Path("scripts/main_post_merge_workspace_fix.py")
source = path.read_text()
old = '''  if (absolute.endsWith(".xcodeproj") || absolute.endsWith(".xcworkspace")) return dirname(absolute);\n'''
new = '''  if (absolute.endsWith(".xcodeproj") || absolute.endsWith(".xcworkspace")) {\n    return dirname(absolute);\n  }\n'''
if source.count(old) < 1:
    raise RuntimeError("Workspace transform anchor repair target is missing")
path.write_text(source.replace(old, new, 1))
print("Repaired workspace project-root transformation anchor.")
