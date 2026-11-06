"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const cp = require("node:child_process");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "../root-pip");
test("packaged native hooks match their activation checksums and target ARM", () => {
  const lines = fs.readFileSync(path.join(root, "hooks.sha256"), "utf8").trim().split(/\r?\n/);
  assert.equal(lines.length, 2);
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  (librw-pip-(?:wam|acb)\.so)$/.exec(line);
    assert.ok(match);
    const bytes = fs.readFileSync(path.join(root, "lib", match[2]));
    assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), match[1]);
    assert.equal(bytes.readUInt16LE(18), 40); // ELF EM_ARM
  }
});
test("root control lifecycle obeys model, firmware, foreground and lease boundaries", (t) => {
  const script = path.join(__dirname, "root-pip-control.py");
  let command = "python3", args = [script];
  if (process.platform === "win32") {
    const converted = cp.spawnSync("wsl.exe", ["-d", "Ubuntu", "--exec", "wslpath", "-u", script], { encoding: "utf8" });
    if (converted.error || converted.status !== 0) { t.skip("Linux/WSL required for shell fixture"); return; }
    command = "wsl.exe";
    args = ["-d", "Ubuntu", "--exec", "python3", converted.stdout.trim()];
  }
  const result = cp.spawnSync(command, args, { encoding: "utf8", timeout: 30000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
  assert.match(result.stdout, /stale-build rejection passed/);
});
