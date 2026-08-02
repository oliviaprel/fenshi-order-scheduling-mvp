import { createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import {
  EncryptedAuditArchive,
  type AuditArchiveManifest,
} from "./encrypted-audit-archive";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "fenshi-audit-archive-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("encrypted audit archive", () => {
  it("durably writes NDJSON compressed with gzip and encrypted with AES-256-GCM", async () => {
    const directory = await temporaryDirectory();
    const key = randomBytes(32);
    const secret = "archive-plaintext-must-not-leak";
    const records = [
      {
        id: "00000000-0000-4000-8000-000000000002",
        actorUserId: null,
        action: "USER_UPDATED",
        targetType: "User",
        targetId: "target-2",
        beforeJson: { status: "ACTIVE" },
        afterJson: { note: secret },
        requestId: "request-2",
        createdAt: new Date("2024-01-02T03:04:05.006Z"),
      },
    ];

    const manifest = await new EncryptedAuditArchive({
      directory,
      keyBase64: key.toString("base64"),
      createArchiveId: () => "fixed-archive-id",
    }).write(records);

    expect(manifest).toMatchObject({
      archiveId: "fixed-archive-id",
      count: 1,
      filename: "audit-fixed-archive-id.ndjson.gz.enc",
    });
    expect(manifest.iv).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(manifest.authenticationTag).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(manifest.ciphertextSha256).toMatch(/^[a-f0-9]{64}$/);

    const files = (await readdir(directory)).sort();
    expect(files).toEqual([
      "audit-fixed-archive-id.manifest.json",
      "audit-fixed-archive-id.ndjson.gz.enc",
    ]);

    const ciphertext = await readFile(join(directory, manifest.filename));
    expect(ciphertext.includes(Buffer.from(secret))).toBe(false);
    expect(createHash("sha256").update(ciphertext).digest("hex")).toBe(
      manifest.ciphertextSha256,
    );

    const persistedManifest = JSON.parse(
      await readFile(join(directory, "audit-fixed-archive-id.manifest.json"), "utf8"),
    ) as AuditArchiveManifest;
    expect(persistedManifest).toEqual(manifest);
    expect(JSON.stringify(persistedManifest)).not.toContain(secret);
    expect(JSON.stringify(persistedManifest)).not.toContain(key.toString("base64"));

    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(manifest.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(manifest.authenticationTag, "base64"));
    const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const ndjson = gunzipSync(compressed).toString("utf8");
    expect(ndjson).toBe(`${JSON.stringify(records[0])}\n`);
  });

  it.each([
    ["not-base64"],
    [randomBytes(31).toString("base64")],
    [randomBytes(33).toString("base64")],
  ])("rejects a key that is not exactly 32 bytes of canonical base64", async (keyBase64) => {
    const directory = await temporaryDirectory();
    const archive = new EncryptedAuditArchive({ directory, keyBase64 });

    await expect(archive.write([])).rejects.toThrow("32-byte base64");
    await expect(readdir(directory)).resolves.toEqual([]);
  });
});
