#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const babel = require("@babel/core");
const presetEnv = require("@babel/preset-env");

const stageDirectory = process.argv[2];
if (!stageDirectory) {
  console.error("Usage: node scripts/transpile.js <staging-directory>");
  process.exit(2);
}

for (const filename of ["auth.js", "app.js"]) {
  const filepath = path.join(stageDirectory, filename);
  const result = babel.transformFileSync(filepath, {
    babelrc: false,
    configFile: false,
    sourceType: "script",
    comments: true,
    compact: false,
    presets: [[presetEnv, { targets: { chrome: "55" }, modules: false }]],
  });
  let code = result.code;
  if (filename === "app.js") {
    // The in-app update check compares this with the published releases.
    const { version } = JSON.parse(fs.readFileSync(path.join(stageDirectory, "appinfo.json"), "utf8"));
    if (!/^\d+\.\d+\.\d+$/.test(version || "")) throw new Error(`Unexpected appinfo.json version: ${version}`);
    const placeholder = /(["'])__RACE_WEEKEND_VERSION__\1/g;
    if (!placeholder.test(code)) throw new Error("app.js is missing the __RACE_WEEKEND_VERSION__ placeholder.");
    code = code.replace(placeholder, JSON.stringify(version));
  }
  fs.writeFileSync(filepath, `${code}\n`);
}
