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
  fs.writeFileSync(filepath, `${result.code}\n`);
}
