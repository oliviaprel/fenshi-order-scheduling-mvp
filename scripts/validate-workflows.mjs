import { readFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseDocument } from "yaml";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowPaths = {
  ci: path.join(projectRoot, ".github", "workflows", "ci.yml"),
  publish: path.join(projectRoot, ".github", "workflows", "publish-image.yml"),
};

const IMAGE_NAME = "ghcr.io/oliviaprel/fenshi-order-scheduling-mvp";
const CI_IMAGE = `${IMAGE_NAME}:ci-\${{ github.sha }}`;
const PUBLISH_IMAGE = `${IMAGE_NAME}:sha-\${{ github.sha }}`;
const DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/fenshi_test";

const ACTIONS = Object.freeze({
  checkout: "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683",
  setupNode: "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
  setupBuildx: "docker/setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f",
  buildImage: "docker/build-push-action@10e90e3645eae34f1e60eeb005ba3a3d33f178e8",
  sbom: "anchore/sbom-action@28d71544de8eaf1b958d335707167c5f783590ad",
  trivy: "aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25",
  uploadArtifact: "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
  login: "docker/login-action@5e57cd118135c172c3672efd75eb46360885c0ef",
  attest: "actions/attest-build-provenance@e8998f949152b193b063cb0ec769d69d929409be",
});

const APPROVED_ACTION_PUBLISHERS = new Set(["actions", "docker", "anchore", "aquasecurity"]);

const CI_WORKFLOW_CONTRACT = Object.freeze({
  name: "CI",
  on: {
    pull_request: { branches: ["master"] },
    push: { branches: ["master"] },
  },
  permissions: { contents: "read" },
  concurrency: {
    group: "ci-${{ github.workflow }}-${{ github.ref }}",
    "cancel-in-progress": true,
  },
});

const CI_JOB_CONTRACT = Object.freeze({
  name: "Quality, container smoke and security scan",
  "runs-on": "ubuntu-latest",
  "timeout-minutes": 45,
  services: {
    postgres: {
      image: "postgres:17-alpine",
      env: {
        POSTGRES_USER: "postgres",
        POSTGRES_PASSWORD: "postgres",
        POSTGRES_DB: "fenshi_test",
      },
      ports: ["5432:5432"],
      options: '--health-cmd "pg_isready -U postgres -d fenshi_test" --health-interval 5s --health-timeout 5s --health-retries 10',
    },
  },
});

const PUBLISH_WORKFLOW_CONTRACT = Object.freeze({
  name: "Publish image",
  on: { push: { branches: ["master"] } },
  permissions: {
    contents: "read",
    packages: "write",
    "id-token": "write",
    attestations: "write",
  },
  concurrency: { group: "publish-master", "cancel-in-progress": false },
  env: { IMAGE_NAME },
});

const PUBLISH_JOB_CONTRACT = Object.freeze({
  name: "Publish scanned and attested image",
  "runs-on": "ubuntu-latest",
  "timeout-minutes": 30,
});

const CI_SMOKE_SCRIPT = `
set -Eeuo pipefail
trap 'docker rm --force fenshi-ci >/dev/null 2>&1 || true' EXIT
docker run --detach --name fenshi-ci --network host \\
  --env APP_ORIGIN=http://127.0.0.1:3000 \\
  --env DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fenshi_test \\
  "$IMAGE_REF"
for attempt in {1..30}; do
  if curl --fail --silent --show-error http://127.0.0.1:3000/api/health/ready; then
    curl --fail --silent --show-error http://127.0.0.1:3000/api/health/live
    exit 0
  fi
  echo "Waiting for container readiness (\${attempt}/30)"
  sleep 2
done
docker logs fenshi-ci
exit 1
`;

const PUBLISH_PUSH_SCRIPT = `
set -Eeuo pipefail
docker push "\${IMAGE_NAME}:sha-\${GITHUB_SHA}"
docker push "\${IMAGE_NAME}:latest"
image_digest="$(docker buildx imagetools inspect \\
  --format '{{.Manifest.Digest}}' \\
  "\${IMAGE_NAME}:sha-\${GITHUB_SHA}")"
if [[ ! "$image_digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "Registry returned an invalid image digest" >&2
  exit 1
fi
printf 'digest=%s\\n' "$image_digest" >> "$GITHUB_OUTPUT"
`;

const MIGRATION_ENV = Object.freeze({ MIGRATION_DATABASE_URL: DATABASE_URL });
const RUNTIME_ENV = Object.freeze({ DATABASE_URL });

const CI_STEP_CONTRACT = Object.freeze([
  { name: "Check out source", id: "checkout", uses: ACTIONS.checkout },
  {
    name: "Set up Node.js",
    id: "setup_node",
    uses: ACTIONS.setupNode,
    with: { "node-version": 22, cache: "npm" },
  },
  { name: "Install dependencies", id: "install_dependencies", run: "npm ci" },
  {
    name: "Validate workflow security invariants",
    id: "validate_workflows",
    run: "npm run test:workflows",
  },
  {
    name: "Verify fresh split-role database bootstrap",
    id: "database_role_smoke",
    run: "npm run test:database-roles",
    env: { POSTGRES_PORT: "55432" },
  },
  { id: "prisma_generate", run: "npm run prisma:generate", env: MIGRATION_ENV },
  { id: "lint", run: "npm run lint" },
  { id: "typecheck", run: "npm run typecheck" },
  { id: "prisma_validate", run: "npm run prisma:validate", env: MIGRATION_ENV },
  { id: "migrate", run: "npx prisma migrate deploy", env: MIGRATION_ENV },
  { id: "unit_tests", run: "npm run test:unit", env: RUNTIME_ENV },
  { id: "integration_tests", run: "npm run test:integration", env: RUNTIME_ENV },
  { id: "install_playwright", run: "npx playwright install --with-deps chromium" },
  {
    id: "e2e_tests",
    run: "npm run test:e2e",
    env: {
      DATABASE_URL,
      APP_ORIGIN: "http://127.0.0.1:3000",
      E2E_ADMIN_PHONE: "13900139000",
      E2E_ADMIN_PASSWORD: "CI-only-admin-pass-2026!",
      E2E_USER_PHONE: "13800138000",
      E2E_USER_PASSWORD: "CI-only-user-temp-pass-2026!",
      E2E_NEW_PASSWORD: "CI-only-user-new-pass-2026!",
      E2E_INVALID_PASSWORD: "CI-only-wrong-pass-2026!",
    },
  },
  {
    id: "production_build",
    run: "npm run build",
    env: { APP_ORIGIN: "http://127.0.0.1:3000", DATABASE_URL },
  },
  { id: "production_audit", run: "npm audit --omit=dev --audit-level=high" },
  { name: "Set up Docker Buildx", id: "setup_buildx", uses: ACTIONS.setupBuildx },
  {
    name: "Build local container image",
    id: "build_image",
    uses: ACTIONS.buildImage,
    with: { context: ".", load: true, push: false, tags: CI_IMAGE },
  },
  {
    name: "Smoke test the running container",
    id: "container_smoke",
    shell: "bash",
    env: { IMAGE_REF: CI_IMAGE },
    run: CI_SMOKE_SCRIPT,
  },
  {
    name: "Generate SPDX JSON SBOM",
    id: "generate_sbom",
    uses: ACTIONS.sbom,
    with: {
      image: CI_IMAGE,
      format: "spdx-json",
      "output-file": "fenshi-ci.spdx.json",
      "artifact-name": "fenshi-ci-sbom.spdx.json",
    },
  },
  {
    name: "Record complete High and Critical inventory",
    id: "vulnerability_inventory",
    uses: ACTIONS.trivy,
    with: {
      "image-ref": CI_IMAGE,
      format: "json",
      severity: "HIGH,CRITICAL",
      "exit-code": "0",
      "ignore-unfixed": false,
      "vuln-type": "os,library",
      output: "trivy-high-critical.json",
    },
  },
  {
    name: "Upload complete vulnerability inventory",
    id: "upload_inventory",
    uses: ACTIONS.uploadArtifact,
    with: {
      name: "fenshi-ci-vulnerabilities-${{ github.sha }}",
      path: "trivy-high-critical.json",
      "if-no-files-found": "error",
    },
  },
  {
    name: "Fail on fixable High and Critical vulnerabilities",
    id: "vulnerability_gate",
    uses: ACTIONS.trivy,
    with: {
      "image-ref": CI_IMAGE,
      format: "table",
      severity: "HIGH,CRITICAL",
      "exit-code": "1",
      "ignore-unfixed": true,
      "vuln-type": "os,library",
    },
  },
]);

const PUBLISH_STEP_CONTRACT = Object.freeze([
  { name: "Check out source", id: "checkout", uses: ACTIONS.checkout },
  { name: "Set up Docker Buildx", id: "setup_buildx", uses: ACTIONS.setupBuildx },
  {
    name: "Build local image for security gates",
    id: "build_image",
    uses: ACTIONS.buildImage,
    with: {
      context: ".",
      load: true,
      push: false,
      tags: `${PUBLISH_IMAGE}\n${IMAGE_NAME}:latest`,
    },
  },
  {
    name: "Generate downloadable SPDX JSON SBOM",
    id: "generate_sbom",
    uses: ACTIONS.sbom,
    with: {
      image: "${{ env.IMAGE_NAME }}:sha-${{ github.sha }}",
      format: "spdx-json",
      "output-file": "fenshi-image.spdx.json",
      "artifact-name": "fenshi-image-${{ github.sha }}.spdx.json",
    },
  },
  {
    name: "Record complete High and Critical inventory",
    id: "vulnerability_inventory",
    uses: ACTIONS.trivy,
    with: {
      "image-ref": "${{ env.IMAGE_NAME }}:sha-${{ github.sha }}",
      format: "json",
      severity: "HIGH,CRITICAL",
      "exit-code": "0",
      "ignore-unfixed": false,
      "vuln-type": "os,library",
      output: "trivy-high-critical.json",
    },
  },
  {
    name: "Upload complete vulnerability inventory",
    id: "upload_inventory",
    uses: ACTIONS.uploadArtifact,
    with: {
      name: "fenshi-image-vulnerabilities-${{ github.sha }}",
      path: "trivy-high-critical.json",
      "if-no-files-found": "error",
    },
  },
  {
    name: "Fail on fixable High and Critical vulnerabilities",
    id: "vulnerability_gate",
    uses: ACTIONS.trivy,
    with: {
      "image-ref": "${{ env.IMAGE_NAME }}:sha-${{ github.sha }}",
      format: "table",
      severity: "HIGH,CRITICAL",
      "exit-code": "1",
      "ignore-unfixed": true,
      "vuln-type": "os,library",
    },
  },
  {
    name: "Log in to GHCR",
    id: "registry_login",
    uses: ACTIONS.login,
    with: {
      registry: "ghcr.io",
      username: "${{ github.actor }}",
      password: "${{ secrets.GITHUB_TOKEN }}",
    },
  },
  { name: "Push the scanned image", id: "push", shell: "bash", run: PUBLISH_PUSH_SCRIPT },
  {
    name: "Attest published image provenance",
    id: "attest_provenance",
    uses: ACTIONS.attest,
    with: {
      "subject-name": "${{ env.IMAGE_NAME }}",
      "subject-digest": "${{ steps.push.outputs.digest }}",
      "push-to-registry": true,
    },
  },
  {
    name: "Record immutable image reference",
    id: "record_image_reference",
    shell: "bash",
    env: { IMAGE_DIGEST: "${{ steps.push.outputs.digest }}" },
    run: "echo \"Published ${IMAGE_NAME}@${IMAGE_DIGEST}\" >> \"$GITHUB_STEP_SUMMARY\"",
  },
]);

function scalar(value) {
  return value === undefined || value === null ? "" : String(value);
}

function entries(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value) : [];
}

function exactStringArray(value, expected) {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((item, index) => item === expected[index]);
}

function exactPermissions(value, expected) {
  const actualEntries = entries(value).sort(([left], [right]) => left.localeCompare(right));
  const expectedEntries = Object.entries(expected).sort(([left], [right]) => left.localeCompare(right));
  return isDeepStrictEqual(actualEntries, expectedEntries);
}

function parseWorkflow(name, source, errors) {
  const document = parseDocument(source, { prettyErrors: true, uniqueKeys: true, version: "1.2" });
  if (document.errors.length > 0) {
    for (const error of document.errors) errors.push(`${name} YAML is invalid: ${error.message}`);
    return null;
  }
  const workflow = document.toJS();
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) {
    errors.push(`${name} workflow root must be a mapping`);
    return null;
  }
  return workflow;
}

function actionName(step) {
  return typeof step?.uses === "string" ? step.uses.split("@")[0] : "";
}

function findActionSteps(steps, name) {
  return steps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => actionName(step) === name);
}

function normalizeImage(value) {
  return scalar(value).replace("${{ env.IMAGE_NAME }}", IMAGE_NAME);
}

function normalizeScript(value) {
  const lines = scalar(value).replace(/\r\n?/g, "\n").split("\n");
  while (lines.length > 0 && lines[0].trim() === "") lines.shift();
  while (lines.length > 0 && lines.at(-1).trim() === "") lines.pop();
  return lines.join("\n");
}

function normalizeLineList(value) {
  return scalar(value)
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function canonicalStep(step) {
  const canonical = structuredClone(step);
  if (canonical && Object.hasOwn(canonical, "run")) canonical.run = normalizeScript(canonical.run);
  if (canonical?.with && Object.hasOwn(canonical.with, "tags")) {
    canonical.with.tags = normalizeLineList(canonical.with.tags);
  }
  return canonical;
}

function validateStepContract(name, steps, contract, errors) {
  const actualShape = steps.map((step) => ({
    id: step?.id,
    type: step?.uses ? "action" : step?.run ? "run" : "invalid",
  }));
  const expectedShape = contract.map((step) => ({
    id: step.id,
    type: step.uses ? "action" : "run",
  }));
  const exactSteps = steps.map(canonicalStep);
  const exactContract = contract.map(canonicalStep);
  if (!isDeepStrictEqual(actualShape, expectedShape) || !isDeepStrictEqual(exactSteps, exactContract)) {
    errors.push(`${name} steps must exactly match the approved sequence, types, fields, and inputs`);
  }
}

function validateWorkflowContract(name, workflow, contract, errors) {
  const workflowShell = structuredClone(workflow);
  delete workflowShell.jobs;
  if (!isDeepStrictEqual(workflowShell, contract)) {
    errors.push(`${name} workflow must exactly match the approved top-level contract`);
  }
}

function validateJobContract(name, job, contract, errors) {
  const jobShell = structuredClone(job);
  delete jobShell.steps;
  if (!isDeepStrictEqual(jobShell, contract)) {
    errors.push(`${name} job must exactly match the approved job fields`);
  }
}

function findNamedProperties(value, propertyName, trail = []) {
  const found = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      found.push(...findNamedProperties(item, propertyName, [...trail, String(index)]));
    });
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      const nextTrail = [...trail, key];
      if (key === propertyName) found.push({ value: item, location: nextTrail.join(".") });
      found.push(...findNamedProperties(item, propertyName, nextTrail));
    }
  }
  return found;
}

function validateActions(workflowName, workflow, errors) {
  for (const reference of findNamedProperties(workflow, "uses")) {
    const action = scalar(reference.value);
    const [name, revision, ...extra] = action.split("@");
    const location = `${workflowName} ${reference.location}`;
    if (!name || !/^[0-9a-f]{40}$/.test(revision ?? "") || extra.length > 0) {
      errors.push(`${location} action must use an immutable 40-character commit SHA: ${action}`);
    }
    if (!APPROVED_ACTION_PUBLISHERS.has(name.split("/")[0])) {
      errors.push(`${location} action is not from an approved official publisher: ${action}`);
    }
  }
}

function containsSecretsContext(value) {
  return /\bsecrets\b/i.test(value);
}

function findSecrets(value, trail = []) {
  const found = [];
  if (typeof value === "string" && containsSecretsContext(value)) found.push(trail.join("."));
  if (Array.isArray(value)) {
    value.forEach((item, index) => found.push(...findSecrets(item, [...trail, String(index)])));
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (containsSecretsContext(key)) found.push([...trail, key].join("."));
      found.push(...findSecrets(item, [...trail, key]));
    }
  }
  return found;
}

function validateTriggers(name, workflow, expected, errors) {
  const triggers = workflow.on;
  if (!triggers || typeof triggers !== "object" || Array.isArray(triggers)) {
    errors.push(`${name} triggers must be a mapping`);
    return;
  }
  const actualNames = Object.keys(triggers).sort();
  const expectedNames = Object.keys(expected).sort();
  if (!isDeepStrictEqual(actualNames, expectedNames)) {
    errors.push(`${name} triggers must be exactly ${expectedNames.join(" and ")}`);
  }
  for (const [triggerName, branches] of Object.entries(expected)) {
    if (!exactStringArray(triggers[triggerName]?.branches, branches)) {
      errors.push(`${name} ${triggerName} branches must be exactly [${branches.join(", ")}]`);
    }
  }
}

function validateDatabaseSteps(steps, errors) {
  const migrationCommands = ["npm run prisma:generate", "npm run prisma:validate", "npx prisma migrate deploy"];
  const runtimeCommands = ["npm run test:unit", "npm run test:integration", "npm run test:e2e"];
  for (const command of migrationCommands) {
    const step = steps.find((candidate) => scalar(candidate?.run).trim() === command);
    if (!step || !scalar(step.env?.MIGRATION_DATABASE_URL)) {
      errors.push(`CI ${command} must receive MIGRATION_DATABASE_URL`);
    }
  }
  for (const command of runtimeCommands) {
    const step = steps.find((candidate) => scalar(candidate?.run).trim() === command);
    if (!step || !scalar(step.env?.DATABASE_URL)) {
      errors.push(`CI ${command} must receive runtime DATABASE_URL`);
    }
  }

  const e2e = steps.find((candidate) => candidate?.id === "e2e_tests");
  const credentialKeys = [
    "E2E_ADMIN_PHONE",
    "E2E_ADMIN_PASSWORD",
    "E2E_USER_PHONE",
    "E2E_USER_PASSWORD",
    "E2E_NEW_PASSWORD",
    "E2E_INVALID_PASSWORD",
  ];
  for (const key of credentialKeys) {
    const value = scalar(e2e?.env?.[key]);
    if (!value || value.includes("${{")) errors.push(`CI ${key} must be a literal non-production fixture value`);
    if (key.endsWith("_PHONE") && !/^1\d{10}$/.test(value)) {
      errors.push(`CI ${key} must be an 11-digit fixture phone number`);
    }
    if (key.endsWith("_PASSWORD")
      && !(value.length >= 16 && /[A-Z]/.test(value) && /[a-z]/.test(value)
        && /\d/.test(value) && /[^A-Za-z0-9]/.test(value))) {
      errors.push(`CI ${key} must be a strong fixture password`);
    }
  }
}

function validateExactInputs(name, role, actual, expected, errors) {
  if (!isDeepStrictEqual(actual, expected)) {
    errors.push(`${name} ${role} inputs must exactly match the approved allowlist`);
  }
}

function validateImageSecurityChain(name, steps, expectedImage, expectedContract, errors) {
  const expectedById = new Map(expectedContract.map((step) => [step.id, step]));
  const sbom = steps.find((step) => step?.id === "generate_sbom");
  if (!sbom || actionName(sbom) !== "anchore/sbom-action") {
    errors.push(`${name} must contain exactly one SBOM step`);
  } else {
    if (scalar(sbom.with?.format) !== "spdx-json") errors.push(`${name} SBOM must use SPDX JSON`);
    if (normalizeImage(sbom.with?.image) !== expectedImage) {
      errors.push(`${name} SBOM image must match the scanned build image`);
    }
  }

  const inventory = steps.find((step) => step?.id === "vulnerability_inventory");
  const gate = steps.find((step) => step?.id === "vulnerability_gate");
  if (!inventory || actionName(inventory) !== "aquasecurity/trivy-action") {
    errors.push(`${name} must contain exactly one vulnerability inventory step`);
  } else {
    validateExactInputs(
      name,
      "inventory",
      inventory.with,
      expectedById.get("vulnerability_inventory").with,
      errors,
    );
    if (inventory.with?.["ignore-unfixed"] !== false) {
      errors.push(`${name} inventory must include unfixed findings`);
    }
    if (normalizeImage(inventory.with?.["image-ref"]) !== expectedImage) {
      errors.push(`${name} inventory image must match the scanned build image`);
    }
  }
  if (!gate || actionName(gate) !== "aquasecurity/trivy-action") {
    errors.push(`${name} must contain exactly one vulnerability gate step`);
  } else {
    validateExactInputs(
      name,
      "gate",
      gate.with,
      expectedById.get("vulnerability_gate").with,
      errors,
    );
    if (gate.with?.["ignore-unfixed"] !== true) {
      errors.push(`${name} gate must ignore unfixed findings`);
    }
    if (normalizeImage(gate.with?.["image-ref"]) !== expectedImage) {
      errors.push(`${name} gate image must match the scanned build image`);
    }
  }

  const upload = steps.find((step) => step?.id === "upload_inventory");
  if (!upload || actionName(upload) !== "actions/upload-artifact") {
    errors.push(`${name} inventory artifact upload step is required exactly once`);
  } else if (inventory) {
    const output = scalar(inventory.with?.output);
    if (!output || scalar(upload.with?.path) !== output) {
      errors.push(`${name} artifact path must exactly match inventory output`);
    }
    if (upload.with?.["if-no-files-found"] !== "error") {
      errors.push(`${name} artifact upload must fail when the inventory file is absent`);
    }
    const inventoryIndex = steps.indexOf(inventory);
    const uploadIndex = steps.indexOf(upload);
    const gateIndex = steps.indexOf(gate);
    if (!(inventoryIndex < uploadIndex && uploadIndex < gateIndex)) {
      errors.push(`${name} inventory artifact must be uploaded after inventory and before the gate`);
    }
  }
}

function validateCi(workflow, errors) {
  validateWorkflowContract("CI", workflow, CI_WORKFLOW_CONTRACT, errors);
  validateTriggers("CI", workflow, { pull_request: ["master"], push: ["master"] }, errors);
  if (!exactPermissions(workflow.permissions, { contents: "read" })) {
    errors.push("CI permissions must be exactly contents: read");
  }
  for (const location of findSecrets(workflow)) {
    errors.push(`CI must not reference secrets. (found at ${location})`);
  }

  const jobs = entries(workflow.jobs);
  if (jobs.length !== 1 || jobs[0][0] !== "quality") errors.push("CI must contain exactly the quality job");
  for (const [jobName, job] of jobs) {
    if (job?.permissions !== undefined) {
      errors.push(`CI job ${jobName} must inherit the root read-only permissions without overrides`);
    }
  }
  validateJobContract("CI quality", workflow.jobs?.quality ?? {}, CI_JOB_CONTRACT, errors);
  const steps = Array.isArray(workflow.jobs?.quality?.steps) ? workflow.jobs.quality.steps : [];
  validateStepContract("CI", steps, CI_STEP_CONTRACT, errors);
  validateDatabaseSteps(steps, errors);

  const build = steps.find((step) => step?.id === "build_image");
  if (!build || actionName(build) !== "docker/build-push-action") {
    errors.push("CI must contain exactly one container build step");
  } else {
    if (build.with?.load !== true) errors.push("CI container build must set load: true");
    if (build.with?.push !== false) errors.push("CI container build must set push: false");
    if (scalar(build.with?.tags).trim() !== CI_IMAGE) errors.push("CI must build the canonical CI image tag");
  }

  const smoke = steps.find((step) => step?.id === "container_smoke");
  if (!smoke || normalizeScript(smoke.run) !== normalizeScript(CI_SMOKE_SCRIPT)) {
    errors.push("CI container smoke script must exactly match the approved template");
  }
  validateImageSecurityChain("CI", steps, CI_IMAGE, CI_STEP_CONTRACT, errors);
}

function validatePublish(workflow, errors) {
  validateWorkflowContract("publish", workflow, PUBLISH_WORKFLOW_CONTRACT, errors);
  validateTriggers("publish", workflow, { push: ["master"] }, errors);
  if (!exactPermissions(workflow.permissions, {
    contents: "read",
    packages: "write",
    "id-token": "write",
    attestations: "write",
  })) {
    errors.push("publish permissions must be exactly contents: read plus packages, id-token, and attestations: write");
  }
  if (workflow.env?.IMAGE_NAME !== IMAGE_NAME) errors.push("publish IMAGE_NAME must be the canonical GHCR repository");

  const jobs = entries(workflow.jobs);
  if (jobs.length !== 1 || jobs[0][0] !== "publish") errors.push("publish workflow must contain exactly the publish job");
  for (const [jobName, job] of jobs) {
    if (job?.permissions !== undefined) {
      errors.push(`publish job ${jobName} must inherit the exact root permissions without overrides`);
    }
  }
  validateJobContract("publish", workflow.jobs?.publish ?? {}, PUBLISH_JOB_CONTRACT, errors);
  const steps = Array.isArray(workflow.jobs?.publish?.steps) ? workflow.jobs.publish.steps : [];
  validateStepContract("publish", steps, PUBLISH_STEP_CONTRACT, errors);

  const build = steps.find((step) => step?.id === "build_image");
  if (!build || actionName(build) !== "docker/build-push-action") {
    errors.push("publish workflow must contain exactly one image build step");
  } else {
    const tags = normalizeLineList(build.with?.tags).split("\n");
    if (build.with?.load !== true) errors.push("publish build must set load: true");
    if (build.with?.push !== false) errors.push("publish build must set push: false");
    if (!exactStringArray(tags, [PUBLISH_IMAGE, `${IMAGE_NAME}:latest`])) {
      errors.push("publish build tags must be exactly the full-sha tag and latest");
    }
  }

  validateImageSecurityChain("publish", steps, PUBLISH_IMAGE, PUBLISH_STEP_CONTRACT, errors);

  const gateIndex = steps.findIndex((step) => step?.id === "vulnerability_gate");
  for (const { index } of findActionSteps(steps, "docker/login-action")) {
    if (index <= gateIndex) errors.push("publish registry login must occur after the vulnerability gate");
  }

  const push = steps.find((step) => step?.id === "push");
  if (!push || normalizeScript(push.run) !== normalizeScript(PUBLISH_PUSH_SCRIPT)) {
    errors.push("publish push script must exactly match the approved template");
  }
  if (push && steps.indexOf(push) <= gateIndex) {
    errors.push("publish push step must occur after the vulnerability gate");
  }

  const attest = steps.find((step) => step?.id === "attest_provenance");
  if (!attest || actionName(attest) !== "actions/attest-build-provenance") {
    errors.push("publish workflow must contain exactly one provenance attestation step");
  } else {
    if (scalar(attest.with?.["subject-name"]) !== "${{ env.IMAGE_NAME }}") {
      errors.push("publish attestation subject-name must be the canonical image name");
    }
    if (scalar(attest.with?.["subject-digest"]) !== "${{ steps.push.outputs.digest }}") {
      errors.push("publish attestation subject-digest must use the pushed digest output");
    }
    if (attest.with?.["push-to-registry"] !== true) {
      errors.push("publish attestation must be pushed to the registry");
    }
    if (push && steps.indexOf(attest) <= steps.indexOf(push)) {
      errors.push("publish attestation must occur after the image push");
    }
  }
}

export function validateWorkflows({ ciSource, publishSource }) {
  const errors = [];
  const ci = parseWorkflow("CI", ciSource, errors);
  const publish = parseWorkflow("publish", publishSource, errors);
  if (ci) {
    validateActions("CI", ci, errors);
    validateCi(ci, errors);
  }
  if (publish) {
    validateActions("publish", publish, errors);
    validatePublish(publish, errors);
  }
  return errors;
}

async function runCli() {
  const [ciSource, publishSource] = await Promise.all([
    readFile(workflowPaths.ci, "utf8"),
    readFile(workflowPaths.publish, "utf8"),
  ]);
  const errors = validateWorkflows({ ciSource, publishSource });
  if (errors.length > 0) {
    console.error("Workflow validation failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log("Workflow validation passed.");
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  await runCli();
}
