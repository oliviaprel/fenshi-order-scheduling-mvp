import { describe, expect, it } from "vitest";
import { auditRetentionCutoff } from "./maintenance.service";

describe("audit retention cutoff", () => {
  it("subtracts two UTC calendar years and clamps leap day to the target month end", () => {
    expect(auditRetentionCutoff(new Date("2024-02-29T12:34:56.789Z"))).toEqual(
      new Date("2022-02-28T12:34:56.789Z"),
    );
  });
});
