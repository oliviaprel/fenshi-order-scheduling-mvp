import { readFile } from "node:fs/promises";
import path from "node:path";
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
const APPROVED_ACTION_PUBLISHERS = new Set(["actions", "docker", "anchore", "aquasecurity"]);

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
  return JSON.stringify(actualEntries) === JSON.stringify(expectedEntries);
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

function commandSteps(steps, pattern) {
  return steps
    .map((step, index) => ({ step, index, run: scalar(step?.run) }))
    .filter(({ run }) => pattern.test(run));
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

function findSecrets(value, trail = []) {
  const found = [];
  if (typeof value === "string" && /\bsecrets\s*\./i.test(value)) found.push(trail.join("."));
  if (Array.isArray(value)) {
    value.forEach((item, index) => found.push(...findSecrets(item, [...trail, String(index)])));
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (/\bsecrets\s*\./i.test(key)) found.push([...trail, key].join("."));
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
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
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

  const e2e = steps.find((candidate) => scalar(candidate?.run).trim() === "npm run test:e2e");
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

function validateImageSecurityChain(name, steps, expectedImage, errors) {
  const sbomMatches = findActionSteps(steps, "anchore/sbom-action");
  if (sbomMatches.length !== 1) {
    errors.push(`${name} must contain exactly one SBOM step`);
  } else {
    const { step } = sbomMatches[0];
    if (scalar(step.with?.format) !== "spdx-json") errors.push(`${name} SBOM must use SPDX JSON`);
    if (normalizeImage(step.with?.image) !== expectedImage) {
      errors.push(`${name} SBOM image must match the scanned build image`);
    }
  }

  const trivy = findActionSteps(steps, "aquasecurity/trivy-action");
  const inventoryMatches = trivy.filter(({ step }) => scalar(step.with?.output));
  const gateMatches = trivy.filter(({ step }) => scalar(step.with?.["exit-code"]) === "1");
  if (inventoryMatches.length !== 1) errors.push(`${name} must contain exactly one vulnerability inventory step`);
  if (gateMatches.length !== 1) errors.push(`${name} must contain exactly one vulnerability gate step`);

  const inventory = inventoryMatches[0];
  const gate = gateMatches[0];
  if (inventory) {
    const settings = inventory.step.with ?? {};
    if (scalar(settings.format) !== "json") errors.push(`${name} inventory must use JSON`);
    if (scalar(settings.severity) !== "CRITICAL,HIGH") errors.push(`${name} inventory must cover CRITICAL,HIGH`);
    if (scalar(settings["exit-code"]) !== "0") errors.push(`${name} inventory must use exit-code 0`);
    if (settings["ignore-unfixed"] !== false) errors.push(`${name} inventory must include unfixed findings`);
    if (normalizeImage(settings["image-ref"]) !== expectedImage) {
      errors.push(`${name} inventory image must match the scanned build image`);
    }
  }
  if (gate) {
    const settings = gate.step.with ?? {};
    if (scalar(settings.format) !== "table") errors.push(`${name} gate must use table output`);
    if (scalar(settings.severity) !== "CRITICAL,HIGH") errors.push(`${name} gate must cover CRITICAL,HIGH`);
    if (settings["ignore-unfixed"] !== true) errors.push(`${name} gate must ignore unfixed findings`);
    if (normalizeImage(settings["image-ref"]) !== expectedImage) {
      errors.push(`${name} gate image must match the scanned build image`);
    }
  }

  const uploads = findActionSteps(steps, "actions/upload-artifact");
  if (uploads.length !== 1) {
    errors.push(`${name} inventory artifact upload step is required exactly once`);
  } else if (inventory) {
    const upload = uploads[0];
    const output = scalar(inventory.step.with?.output);
    if (!output || scalar(upload.step.with?.path) !== output) {
      errors.push(`${name} artifact path must exactly match inventory output`);
    }
    if (upload.step.with?.["if-no-files-found"] !== "error") {
      errors.push(`${name} artifact upload must fail when the inventory file is absent`);
    }
    if (!(inventory.index < upload.index && (!gate || upload.index < gate.index))) {
      errors.push(`${name} inventory artifact must be uploaded after inventory and before the gate`);
    }
  }

  return { gateIndex: gate?.index ?? -1 };
}

function validateCi(workflow, errors) {
  validateTriggers("CI", workflow, { pull_request: ["master"], push: ["master"] }, errors);
  if (!exactPermissions(workflow.permissions, { contents: "read" })) {
    errors.push("CI permissions must be exactly contents: read");
  }
  const secretLocations = findSecrets(workflow);
  for (const location of secretLocations) errors.push(`CI must not reference secrets. (found at ${location})`);

  const jobs = entries(workflow.jobs);
  if (jobs.length !== 1 || jobs[0][0] !== "quality") errors.push("CI must contain exactly the quality job");
  for (const [jobName, job] of jobs) {
    if (job?.permissions !== undefined) {
      errors.push(`CI job ${jobName} must inherit the root read-only permissions without overrides`);
    }
  }
  const steps = Array.isArray(workflow.jobs?.quality?.steps) ? workflow.jobs.quality.steps : [];
  validateDatabaseSteps(steps, errors);

  for (const { step } of findActionSteps(steps, "docker/login-action")) {
    errors.push(`CI must not authenticate to a registry (${step.name ?? "unnamed step"})`);
  }
  for (const { step } of commandSteps(steps, /\bdocker\s+(?:login|push)\b/)) {
    errors.push(`CI must not run docker login or push (${step.name ?? "unnamed step"})`);
  }
  for (const step of steps) {
    if (step?.with?.push === true || scalar(step?.with?.push) === "true") {
      errors.push(`CI must not enable action-based image pushes (${step.name ?? "unnamed step"})`);
    }
  }
  if (findActionSteps(steps, "actions/attest-build-provenance").length > 0) {
    errors.push("CI must not create registry attestations");
  }

  const builds = findActionSteps(steps, "docker/build-push-action");
  if (builds.length !== 1) {
    errors.push("CI must contain exactly one container build step");
  } else {
    const settings = builds[0].step.with ?? {};
    if (settings.load !== true) errors.push("CI container build must set load: true");
    if (settings.push !== false) errors.push("CI container build must set push: false");
    if (scalar(settings.tags).trim() !== CI_IMAGE) errors.push("CI must build the canonical CI image tag");
  }

  const smokes = commandSteps(steps, /\bdocker\s+run\b/);
  if (smokes.length !== 1
    || !/\/api\/health\/ready\b/.test(smokes[0].run)
    || !/\/api\/health\/live\b/.test(smokes[0].run)) {
    errors.push("CI must run the built container and check both ready and live health endpoints");
  }
  validateImageSecurityChain("CI", steps, CI_IMAGE, errors);
}

function validatePublish(workflow, errors) {
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
  const steps = Array.isArray(workflow.jobs?.publish?.steps) ? workflow.jobs.publish.steps : [];
  const builds = findActionSteps(steps, "docker/build-push-action");
  if (builds.length !== 1) {
    errors.push("publish workflow must contain exactly one image build step");
  } else {
    const settings = builds[0].step.with ?? {};
    const tags = scalar(settings.tags).split(/\r?\n/).map((tag) => tag.trim()).filter(Boolean);
    if (settings.load !== true) errors.push("publish build must set load: true");
    if (settings.push !== false) errors.push("publish build must set push: false");
    if (!exactStringArray(tags, [PUBLISH_IMAGE, `${IMAGE_NAME}:latest`])) {
      errors.push("publish build tags must be exactly the full-sha tag and latest");
    }
  }

  const { gateIndex } = validateImageSecurityChain("publish", steps, PUBLISH_IMAGE, errors);
  const logins = findActionSteps(steps, "docker/login-action");
  if (logins.length !== 1) errors.push("publish workflow must contain exactly one GHCR login step");
  for (const { index } of logins) {
    if (index <= gateIndex) errors.push("publish registry login must occur after the vulnerability gate");
  }
  const pushes = commandSteps(steps, /\bdocker\s+push\b/);
  if (pushes.length !== 1) errors.push("publish workflow must contain exactly one push step");
  for (const { index } of pushes) {
    if (index <= gateIndex) errors.push("publish docker push must occur after the vulnerability gate");
  }

  const push = pushes[0]?.step;
  const pushRun = scalar(push?.run);
  if (push?.id !== "push"
    || !/docker push "\$\{IMAGE_NAME\}:sha-\$\{GITHUB_SHA\}"/.test(pushRun)
    || !/docker push "\$\{IMAGE_NAME\}:latest"/.test(pushRun)
    || !/echo "digest=\$image_digest" >> "\$GITHUB_OUTPUT"/.test(pushRun)) {
    errors.push("publish push step must push full-sha and latest tags and expose the registry digest");
  }

  const attestations = findActionSteps(steps, "actions/attest-build-provenance");
  if (attestations.length !== 1) {
    errors.push("publish workflow must contain exactly one provenance attestation step");
  } else {
    const { step, index } = attestations[0];
    if (scalar(step.with?.["subject-name"]) !== "${{ env.IMAGE_NAME }}") {
      errors.push("publish attestation subject-name must be the canonical image name");
    }
    if (scalar(step.with?.["subject-digest"]) !== "${{ steps.push.outputs.digest }}") {
      errors.push("publish attestation subject-digest must use the pushed digest output");
    }
    if (step.with?.["push-to-registry"] !== true) errors.push("publish attestation must be pushed to the registry");
    if (pushes[0] && index <= pushes[0].index) errors.push("publish attestation must occur after the image push");
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
