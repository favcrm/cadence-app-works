// WRK-7: turn a version release into a reviewed-by-CI marketplace PR.
// The tenant's install/approve is the product gate; this script only moves bytes.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const APP_DIR = "app";
const REPO = "favcrm/cadence-app-works";
const MARKETPLACE = "agenticos-stack/agenticos-v2";
const token = process.env.MARKETPLACE_TOKEN;
const dryRun = process.env.DRY_RUN === "1";
const localMarketplace = process.env.MARKETPLACE_DIR;

function sh(cmd, args, cwd, env = {}) {
  return execFileSync(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "inherit"] }).toString();
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

const check = JSON.parse(readFileSync(process.env.APP_CHECK_JSON ?? "/tmp/app-check.json", "utf8"));
if (!check.ok) throw new Error("app check refused: " + JSON.stringify(check.refusals ?? check));
const digest = check.digest;
const version = check.version ?? (readFileSync("app/app.md", "utf8").match(/^version:\s*['"]?([^'"\n]+)['"]?$/m)?.[1]);
if (!digest || !version) throw new Error("app check did not report a version and digest");

const catalogue = JSON.parse(readFileSync("catalogue.json", "utf8"));
const files = {};
for (const full of walk(APP_DIR).sort()) files[relative(APP_DIR, full)] = readFileSync(full, "utf8");
const upload = JSON.stringify({ files }, null, 2) + "\n";
const artifact = `marketplace/releases/${catalogue.id}/${version}/upload.json`;
const entry = {
  ...catalogue,
  version,
  source: { repo: REPO, commit: process.env.GITHUB_SHA, path: APP_DIR },
  artifact: { path: artifact, sha256: sha256(upload) },
  digest,
};

function applyTo(dir) {
  mkdirSync(join(dir, "marketplace/releases", catalogue.id, version), { recursive: true });
  writeFileSync(join(dir, artifact), upload);
  const manifestPath = join(dir, "marketplace/apps.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const index = manifest.apps.findIndex((a) => a.id === catalogue.id);
  const current = index >= 0 ? manifest.apps[index] : null;
  const artifactPath = join(dir, artifact);
  const sameBytes = statSync(artifactPath, { throwIfNoEntry: false }) && sha256(readFileSync(artifactPath)) === sha256(upload);
  if (current && current.version === version && current.digest === digest && current.artifact?.sha256 === sha256(upload) && sameBytes) {
    console.log("marketplace already carries this version, digest and artifact; nothing to do");
    return false;
  }
  const json = JSON.stringify(entry, null, 2) + "\n";
  if (index >= 0) manifest.apps[index] = entry;
  else manifest.apps.push(entry);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  return true;
}

if (dryRun) {
  console.log(JSON.stringify({ entry, artifactSha256: sha256(upload), files: Object.keys(files) }, null, 2));
  process.exit(0);
}

if (localMarketplace) {
  if (applyTo(localMarketplace)) console.log("wrote the marketplace files under " + localMarketplace);
  process.exit(0);
}

if (!token) throw new Error("MARKETPLACE_TOKEN is required (contents + pull-requests on " + MARKETPLACE + ")");
const dir = mkdtempSync(join(tmpdir(), "marketplace-"));
const url = `https://x-access-token:${token}@github.com/${MARKETPLACE}.git`;
sh("git", ["clone", "--depth=1", "--branch", "staging", url, dir], process.cwd());
if (!applyTo(dir)) process.exit(0);
sh("git", ["-c", "user.name=cadence-release-bot", "-c", "user.email=release-bot@favcrm.local", "checkout", "-b", `publish/${catalogue.id}-${version}`], dir);
sh("git", ["add", "-A"], dir);
sh("git", ["-c", "user.name=cadence-release-bot", "-c", "user.email=release-bot@favcrm.local", "commit", "-m", `Publish ${catalogue.id} ${version}`], dir);
sh("git", ["push", "origin", `publish/${catalogue.id}-${version}`], dir, { GH_TOKEN: token });
const title = `Publish ${catalogue.id} ${version}`;
const body = `Automated release from ${REPO}@${process.env.GITHUB_SHA}.\n\n- Bundle: ${artifact} (sha256:${entry.artifact.sha256})\n- Digest: ${digest}\n- Review is the tenant install/approve; the marketplace CI gates the merge.\n\nIssue: WRK-7`;
const pr = sh("gh", ["pr", "create", "--repo", MARKETPLACE, "--base", "staging", "--head", `publish/${catalogue.id}-${version}`, "--title", title, "--body", body], dir, { GH_TOKEN: token }).trim();
console.log(pr);
try {
  sh("gh", ["pr", "merge", pr, "--repo", MARKETPLACE, "--auto", "--merge"], dir, { GH_TOKEN: token });
  console.log("auto-merge enabled");
} catch (error) {
  console.log("auto-merge unavailable; the PR is open for CI and normal merge: " + error.message);
}
