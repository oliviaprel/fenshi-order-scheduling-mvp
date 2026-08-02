import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse, stringify } from "yaml";

import { validateWorkflows } from "./validate-workflows.mjs";

const [ciSource, publishSource] = await Promise.all([
  readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
  readFile(new URL("../.github/workflows/publish-image.yml", import.meta.url), "utf8"),
]);

function mutate(source, mutation) {
  const workflow = parse(source);
  mutation(workflow);
  return stringify(workflow);
}

function validate(overrides = {}) {
  return validateWorkflows({ ciSource, publishSource, ...overrides });
}

function expectError(errors, fragment) {
  assert.ok(
    errors.some((error) => error.includes(fragment)),
    `expected an error containing ${JSON.stringify(fragment)}, got:\n${errors.join("\n")}`,
  );
}

function steps(workflow, jobName) {
  return workflow.jobs[jobName].steps;
}

test("the committed workflows satisfy every structural invariant", () => {
  assert.deepEqual(validate(), []);
});

test("rejects changing the pull-request target from master to develop", () => {
  const mutated = mutate(ciSource, (workflow) => {
    workflow.on.pull_request.branches = ["develop"];
  });
  expectError(validate({ ciSource: mutated }), "pull_request branches must be exactly [master]");
});

test("rejects even read-only package permission in pull-request CI", () => {
  const mutated = mutate(ciSource, (workflow) => {
    workflow.permissions.packages = "read";
  });
  expectError(validate({ ciSource: mutated }), "permissions must be exactly contents: read");
});

test("rejects job-level permission overrides in pull-request CI", () => {
  const mutated = mutate(ciSource, (workflow) => {
    workflow.jobs.quality.permissions = { contents: "read", packages: "write" };
  });
  expectError(validate({ ciSource: mutated }), "inherit the root read-only permissions without overrides");
});

test("rejects swapping inventory and gate ignore-unfixed semantics", () => {
  const mutated = mutate(ciSource, (workflow) => {
    const trivySteps = steps(workflow, "quality").filter((step) =>
      step.uses?.startsWith("aquasecurity/trivy-action@"),
    );
    trivySteps[0].with["ignore-unfixed"] = true;
    trivySteps[1].with["ignore-unfixed"] = false;
  });
  const errors = validate({ ciSource: mutated });
  expectError(errors, "inventory must include unfixed findings");
  expectError(errors, "gate must ignore unfixed findings");
});

test("rejects a missing or mismatched inventory artifact path", async (t) => {
  await t.test("missing uploader", () => {
    const mutated = mutate(ciSource, (workflow) => {
      workflow.jobs.quality.steps = steps(workflow, "quality").filter(
        (step) => !step.uses?.startsWith("actions/upload-artifact@"),
      );
    });
    expectError(validate({ ciSource: mutated }), "inventory artifact upload step is required");
  });

  await t.test("path does not match inventory output", () => {
    const mutated = mutate(ciSource, (workflow) => {
      const upload = steps(workflow, "quality").find((step) =>
        step.uses?.startsWith("actions/upload-artifact@"),
      );
      upload.with.path = "some-other-report.json";
    });
    expectError(validate({ ciSource: mutated }), "artifact path must exactly match inventory output");
  });
});

test("rejects every registry login and push placed before the scan gate", () => {
  const mutated = mutate(publishSource, (workflow) => {
    const publishSteps = steps(workflow, "publish");
    const gateIndex = publishSteps.findIndex(
      (step) => step.with?.["exit-code"] === "1" || step.with?.["exit-code"] === 1,
    );
    publishSteps.splice(
      gateIndex,
      0,
      {
        name: "Early login",
        uses: "docker/login-action@5e57cd118135c172c3672efd75eb46360885c0ef",
      },
      { name: "Early push", run: 'docker push "${IMAGE_NAME}:latest"' },
    );
  });
  const errors = validate({ publishSource: mutated });
  expectError(errors, "registry login must occur after the vulnerability gate");
  expectError(errors, "publish steps must exactly match the approved sequence");
});

test("rejects any secrets context in pull-request CI", () => {
  const mutated = mutate(ciSource, (workflow) => {
    steps(workflow, "quality")[2].env = { TOKEN: "${{ secrets.SOME_TOKEN }}" };
  });
  expectError(validate({ ciSource: mutated }), "must not reference secrets.");
});

test("rejects spaced single- and double-quoted bracket secrets in pull-request CI", () => {
  for (const expression of ["${{ secrets['TOKEN'] }}", '${{ secrets [ "TOKEN" ] }}']) {
    const mutated = mutate(ciSource, (workflow) => {
      steps(workflow, "quality")[2].env = { TOKEN: expression };
    });
    expectError(validate({ ciSource: mutated }), "must not reference secrets.");
  }
});

test("rejects an extra shell login and docker image push before the gate", () => {
  const mutated = mutate(publishSource, (workflow) => {
    const publishSteps = steps(workflow, "publish");
    const gateIndex = publishSteps.findIndex(
      (step) => step.with?.["exit-code"] === "1" || step.with?.["exit-code"] === 1,
    );
    publishSteps.splice(gateIndex, 0, {
      name: "Bypass registry gate",
      shell: "bash",
      run: "docker login ghcr.io\ndocker image push \"${IMAGE_NAME}:latest\"",
    });
  });
  expectError(
    validate({ publishSource: mutated }),
    "publish steps must exactly match the approved sequence",
  );
});

test("rejects weakened Trivy scope and exclusion inputs", () => {
  const mutated = mutate(ciSource, (workflow) => {
    const inventory = steps(workflow, "quality").find((step) => step.with?.output);
    inventory.with["vuln-type"] = "os";
    inventory.with["skip-files"] = "usr/local/lib/node_modules/**";
  });
  expectError(
    validate({ ciSource: mutated }),
    "CI inventory inputs must exactly match the approved allowlist",
  );
});

test("rejects a push script that overwrites the attested digest output", () => {
  const mutated = mutate(publishSource, (workflow) => {
    const push = steps(workflow, "publish").find((step) => step.id === "push");
    push.run += '\necho "digest=sha256:0000000000000000000000000000000000000000000000000000000000000000" >> "$GITHUB_OUTPUT"';
  });
  expectError(
    validate({ publishSource: mutated }),
    "publish push script must exactly match the approved template",
  );
});

test("rejects actions that are not pinned to a 40-character commit SHA", () => {
  const mutated = mutate(ciSource, (workflow) => {
    steps(workflow, "quality")[0].uses = "actions/checkout@v4";
  });
  expectError(validate({ ciSource: mutated }), "40-character commit SHA");
});

test("rejects unpinned job-level reusable workflows too", () => {
  const mutated = mutate(ciSource, (workflow) => {
    workflow.jobs.reusable = { uses: "actions/example-workflow@v1" };
  });
  expectError(validate({ ciSource: mutated }), "40-character commit SHA");
});

test("binds SBOM and both scans to the exact built image", () => {
  const mutated = mutate(publishSource, (workflow) => {
    const sbom = steps(workflow, "publish").find((step) =>
      step.uses?.startsWith("anchore/sbom-action@"),
    );
    sbom.with.image = "ghcr.io/example/unscanned:latest";
  });
  expectError(validate({ publishSource: mutated }), "SBOM image must match the scanned build image");
});

test("requires provenance to attest the pushed digest under the canonical image name", () => {
  const mutated = mutate(publishSource, (workflow) => {
    const attest = steps(workflow, "publish").find((step) =>
      step.uses?.startsWith("actions/attest-build-provenance@"),
    );
    attest.with["subject-name"] = "ghcr.io/example/wrong";
    attest.with["subject-digest"] = "${{ github.sha }}";
  });
  const errors = validate({ publishSource: mutated });
  expectError(errors, "attestation subject-name must be the canonical image name");
  expectError(errors, "attestation subject-digest must use the pushed digest output");
});
