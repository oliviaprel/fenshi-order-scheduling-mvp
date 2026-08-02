import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("maintenance scheduling artifacts", () => {
  it("documents a non-root cron.d job whose failure chain preserves every error", () => {
    const runbook = readFileSync(resolve("docs/runbooks/maintenance.md"), "utf8");
    const cronBlock = runbook.match(/```cron\r?\n([\s\S]*?)```/)?.[1] ?? "";

    expect(runbook).toContain("/etc/cron.d/fenshi-maintenance");
    expect(cronBlock).toMatch(/^SHELL=\/bin\/bash$/m);
    expect(cronBlock).toMatch(/^20 3 \* \* \* fenshi \/bin\/bash /m);
    expect(cronBlock).not.toMatch(/^20 3 \* \* \* root /m);
    expect(cronBlock).toContain("set -euo pipefail");
    expect(cronBlock).toContain(". /etc/fenshi/maintenance.env");
    expect(cronBlock).toContain("cd /opt/fenshi/release");
    expect(cronBlock).toContain("/usr/bin/flock -n");
    expect(cronBlock).toContain("npm run --silent maintenance:daily");
    expect(cronBlock.indexOf("maintenance.env")).toBeLessThan(cronBlock.indexOf("cd /opt"));
    expect(cronBlock.indexOf("cd /opt")).toBeLessThan(cronBlock.indexOf("flock -n"));
  });
});
