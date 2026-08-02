import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowPaths = {
  ci: path.join(projectRoot, ".github", "workflows", "ci.yml"),
  publish: path.join(projectRoot, ".github", "workflows", "publish-image.yml"),
};

const errors = [];

function requireMatch(source, pattern, message) {
  if (!pattern.test(source)) errors.push(message);
}

function rejectMatch(source, pattern, message) {
  if (pattern.test(source)) errors.push(message);
}

async function readWorkflow(name, workflowPath) {
  try {
    return await readFile(workflowPath, "utf8");
  } catch {
    errors.push(`${name} workflow is missing: ${path.relative(projectRoot, workflowPath)}`);
    return "";
  }
}

const [ci, publish] = await Promise.all([
  readWorkflow("CI", workflowPaths.ci),
  readWorkflow("publish", workflowPaths.publish),
]);

const imageName = "ghcr.io/oliviaprel/fenshi-order-scheduling-mvp";
const writePermission = /^\s+[a-z-]+:\s*write\s*$/m;

for (const [name, source] of [["CI", ci], ["publish", publish]]) {
  for (const match of source.matchAll(/^\s+uses:\s*([^\s#]+).*$/gm)) {
    const action = match[1];
    if (!/@[0-9a-f]{40}$/.test(action)) {
      errors.push(`${name} action must use an immutable 40-character commit SHA: ${action}`);
    }
    if (!/^(?:actions|docker|anchore|aquasecurity)\//.test(action)) {
      errors.push(`${name} action is not from an approved official publisher: ${action}`);
    }
  }
}

requireMatch(ci, /^\s*pull_request:\s*$/m, "CI must run for pull requests");
requireMatch(ci, /^\s*branches:\s*\[master\]\s*$/m, "CI push trigger must target branches: [master]");
requireMatch(ci, /docker\/build-push-action@[0-9a-f]{40}/, "CI must use an immutable docker/build-push-action revision");
requireMatch(ci, /^\s+push:\s*false\s*$/m, "CI container build must explicitly set push: false");
requireMatch(ci, new RegExp(`tags:\\s*${imageName.replaceAll("/", "\\/")}:ci-`), "CI must build the canonical GHCR image name locally");
requireMatch(ci, /docker run[^\n]*(?:--detach|-d)[^\n]*fenshi-ci/, "CI must start the built container for a smoke test");
requireMatch(ci, /curl[^\n]*\/api\/health\/live/, "CI smoke test must call the live health endpoint");
requireMatch(ci, /anchore\/sbom-action@[0-9a-f]{40}/, "CI must generate an SBOM with an immutable Anchore action revision");
requireMatch(ci, /^\s+format:\s*spdx-json\s*$/m, "CI SBOM must use SPDX JSON");
requireMatch(ci, /aquasecurity\/trivy-action@[0-9a-f]{40}/, "CI must scan the image with an immutable Trivy action revision");
requireMatch(ci, /^\s+severity:\s*['"]?CRITICAL,HIGH['"]?\s*$/m, "CI Trivy scan must cover High and Critical findings");
requireMatch(ci, /^\s+exit-code:\s*['"]1['"]\s*$/m, "CI Trivy scan must fail on findings");
requireMatch(ci, /^\s+ignore-unfixed:\s*true\s*$/m, "CI Trivy scan must distinguish actionable findings from unfixed upstream findings");
requireMatch(ci, /^\s+ignore-unfixed:\s*false\s*$/m, "CI must retain unfixed findings in its complete vulnerability inventory");
requireMatch(ci, /^\s+output:\s*trivy-high-critical\.json\s*$/m, "CI must write a complete High/Critical JSON inventory");
requireMatch(ci, /^\s+exit-code:\s*['"]0['"]\s*$/m, "CI complete vulnerability inventory must never hide its artifact behind the gate exit code");
requireMatch(ci, /actions\/upload-artifact@[0-9a-f]{40}/, "CI must upload the complete vulnerability inventory");
rejectMatch(ci, writePermission, "CI must not grant any write permission");
rejectMatch(ci, /docker\/login-action@/, "CI must not authenticate to a container registry");
rejectMatch(ci, /^\s+push:\s*true\s*$/m, "CI must never push an image");
rejectMatch(ci, /docker\s+push\b/, "CI must never run docker push");
rejectMatch(ci, /actions\/attest-build-provenance@/, "CI must not create registry attestations");

for (const command of ["prisma:generate", "prisma:validate", "prisma migrate deploy"]) {
  requireMatch(
    ci,
    new RegExp(`- run: (?:npm run |npx )${command.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\r?\\n\\s+env:\\r?\\n\\s+MIGRATION_DATABASE_URL:`),
    `CI ${command} must receive MIGRATION_DATABASE_URL`,
  );
}
for (const command of ["test:unit", "test:integration", "test:e2e"]) {
  requireMatch(
    ci,
    new RegExp(`- run: npm run ${command}\\r?\\n\\s+env:\\r?\\n\\s+DATABASE_URL:`),
    `CI ${command} must receive runtime DATABASE_URL`,
  );
}

requireMatch(publish, /^\s*branches:\s*\[master\]\s*$/m, "publish workflow must run only for master pushes");
rejectMatch(publish, /^\s*(?:pull_request|pull_request_target|workflow_dispatch|schedule):/m, "publish workflow must not run for pull requests, manual dispatch, or schedules");
for (const permission of ["contents: read", "packages: write", "id-token: write", "attestations: write"]) {
  requireMatch(publish, new RegExp(`^\\s+${permission.replace(" ", "\\s+")}\\s*$`, "m"), `publish workflow must grant ${permission}`);
}
for (const match of publish.matchAll(/^\s+([a-z-]+):\s*write\s*$/gm)) {
  if (!new Set(["packages", "id-token", "attestations"]).has(match[1])) {
    errors.push(`publish workflow has unnecessary write permission: ${match[1]}`);
  }
}
requireMatch(publish, /docker\/login-action@[0-9a-f]{40}/, "publish workflow must use an immutable GHCR login action revision");
requireMatch(publish, /docker\/build-push-action@[0-9a-f]{40}/, "publish workflow must use an immutable build action revision");
requireMatch(publish, /^\s+load:\s*true\s*$/m, "publish workflow must load the exact image that will be scanned and pushed");
requireMatch(publish, /^\s+push:\s*false\s*$/m, "publish build must not push before the vulnerability gate");
requireMatch(publish, /docker push "\$\{IMAGE_NAME\}:sha-\$\{GITHUB_SHA\}"/, "publish workflow must push sha-<full commit> after scanning");
requireMatch(publish, /docker push "\$\{IMAGE_NAME\}:latest"/, "publish workflow must push latest after scanning");
requireMatch(publish, new RegExp(`${imageName.replaceAll("/", "\\/")}:sha-\\$\\{\\{ github\\.sha \\}\\}`), "publish workflow must tag sha-<full commit>");
requireMatch(publish, new RegExp(`${imageName.replaceAll("/", "\\/")}:latest`), "publish workflow must tag latest");
requireMatch(publish, /anchore\/sbom-action@[0-9a-f]{40}/, "publish workflow must create an SBOM with an immutable action revision");
requireMatch(publish, /^\s+format:\s*spdx-json\s*$/m, "publish SBOM must use SPDX JSON");
requireMatch(publish, /aquasecurity\/trivy-action@[0-9a-f]{40}/, "publish workflow must scan with an immutable Trivy action revision");
requireMatch(publish, /^\s+severity:\s*['"]?CRITICAL,HIGH['"]?\s*$/m, "publish Trivy scan must cover High and Critical findings");
requireMatch(publish, /^\s+exit-code:\s*['"]1['"]\s*$/m, "publish Trivy scan must fail on findings");
requireMatch(publish, /^\s+ignore-unfixed:\s*true\s*$/m, "publish Trivy scan must distinguish actionable findings from unfixed upstream findings");
requireMatch(publish, /^\s+ignore-unfixed:\s*false\s*$/m, "publish must retain unfixed findings in its complete vulnerability inventory");
requireMatch(publish, /^\s+output:\s*trivy-high-critical\.json\s*$/m, "publish must write a complete High/Critical JSON inventory");
requireMatch(publish, /^\s+exit-code:\s*['"]0['"]\s*$/m, "publish complete vulnerability inventory must be uploaded before gating");
requireMatch(publish, /actions\/upload-artifact@[0-9a-f]{40}/, "publish must upload the complete vulnerability inventory");
requireMatch(publish, /actions\/attest-build-provenance@[0-9a-f]{40}/, "publish workflow must create provenance with an immutable action revision");
requireMatch(publish, /^\s+push-to-registry:\s*true\s*$/m, "publish provenance must be pushed to GHCR");
requireMatch(publish, /^\s+subject-digest:\s*\$\{\{ steps\.push\.outputs\.digest \}\}\s*$/m, "publish provenance must attest the pushed digest");

const publishGateIndex = publish.indexOf("- name: Fail on fixable High and Critical vulnerabilities");
const publishLoginIndex = publish.indexOf("- name: Log in to GHCR");
const publishPushIndex = publish.indexOf('docker push "${IMAGE_NAME}:sha-${GITHUB_SHA}"');
if (publishGateIndex < 0 || publishLoginIndex < publishGateIndex || publishPushIndex < publishLoginIndex) {
  errors.push("publish workflow must scan and pass the vulnerability gate before GHCR login and push");
}

if (errors.length > 0) {
  console.error("Workflow validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log("Workflow validation passed.");
}
