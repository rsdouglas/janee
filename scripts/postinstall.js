#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const os = require("os");

const SKILL_TARGETS = [
  { name: "Claude Code", dir: path.join(os.homedir(), ".claude", "skills") },
  { name: "Codex", dir: path.join(os.homedir(), ".codex", "skills") },
  { name: "Cursor", dir: path.join(os.homedir(), ".cursor", "skills") },
];

const skillSrc = path.join(__dirname, "..", "SKILL.md");

if (!fs.existsSync(skillSrc)) {
  process.exit(0);
}

const skillContent = fs.readFileSync(skillSrc);

for (const target of SKILL_TARGETS) {
  const destDir = path.join(target.dir, "janee");
  const destFile = path.join(destDir, "SKILL.md");

  try {
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(destFile, skillContent);
    console.log(`janee: installed skill for ${target.name} → ${destFile}`);
  } catch {
    // Non-fatal — permissions, read-only fs, etc.
  }
}
