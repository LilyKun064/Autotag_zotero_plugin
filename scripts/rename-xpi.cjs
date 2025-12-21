/* eslint-env node */

const fs = require("fs");
const path = require("path");

const pkg = require("../package.json");

const buildDir = path.join(
  __dirname,
  "..",
  ".scaffold",
  "build"
);

const from = path.join(buildDir, "autotag.xpi");
const to = path.join(
  buildDir,
  `autotag-${pkg.version}.xpi`
);

if (fs.existsSync(from)) {
  fs.renameSync(from, to);
  console.log(`XPI renamed to autotag-${pkg.version}.xpi`);
} else {
  console.warn("autotag.xpi not found. Nothing renamed.");
}
