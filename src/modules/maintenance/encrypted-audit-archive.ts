import { createCipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import type { AuditLog } from "../../generated/prisma/client";

export type AuditArchiveRecord = AuditLog;

export type AuditArchiveReceipt = {
  archiveId: string;
};

export type AuditArchive = {
  write(records: readonly AuditArchiveRecord[]): Promise<AuditArchiveReceipt>;
};

export type AuditArchiveManifest = AuditArchiveReceipt & {
  filename: string;
  count: number;
  iv: string;
  authenticationTag: string;
  ciphertextSha256: string;
  algorithm: "AES-256-GCM";
  compression: "gzip";
  format: "NDJSON";
};

type EncryptedAuditArchiveOptions = {
  directory: string;
  keyBase64: string;
  createArchiveId?: () => string;
};

function decodeKey(keyBase64: string): Buffer {
  const isBase64 =
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(keyBase64);
  const key = Buffer.from(keyBase64, "base64");
  if (!isBase64 || key.length !== 32 || key.toString("base64") !== keyBase64) {
    throw new Error("AUDIT_ARCHIVE_KEY must be a canonical 32-byte base64 key.");
  }
  return key;
}

async function syncDirectory(directory: string): Promise<void> {
  if (process.platform === "win32") {
    return;
  }
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function atomicWrite(directory: string, filename: string, contents: Buffer): Promise<void> {
  const finalPath = join(directory, filename);
  const temporaryPath = join(directory, `.${filename}.${process.pid}.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;

  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, finalPath);
    await syncDirectory(directory);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export class EncryptedAuditArchive implements AuditArchive {
  readonly #directory: string;
  readonly #keyBase64: string;
  readonly #createArchiveId: () => string;

  constructor(options: EncryptedAuditArchiveOptions) {
    this.#directory = resolve(options.directory);
    this.#keyBase64 = options.keyBase64;
    this.#createArchiveId = options.createArchiveId ?? randomUUID;
  }

  async write(records: readonly AuditArchiveRecord[]): Promise<AuditArchiveManifest> {
    const key = decodeKey(this.#keyBase64);
    const archiveId = this.#createArchiveId();
    if (!/^[A-Za-z0-9._-]+$/.test(archiveId)) {
      throw new Error("Archive ID contains unsafe filename characters.");
    }

    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    const filename = `audit-${archiveId}.ndjson.gz.enc`;
    const ndjson = Buffer.from(records.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8");
    const compressed = gzipSync(ndjson);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
    const manifest: AuditArchiveManifest = {
      archiveId,
      filename: basename(filename),
      count: records.length,
      iv: iv.toString("base64"),
      authenticationTag: cipher.getAuthTag().toString("base64"),
      ciphertextSha256: createHash("sha256").update(ciphertext).digest("hex"),
      algorithm: "AES-256-GCM",
      compression: "gzip",
      format: "NDJSON",
    };

    await atomicWrite(this.#directory, filename, ciphertext);
    await atomicWrite(
      this.#directory,
      `audit-${archiveId}.manifest.json`,
      Buffer.from(`${JSON.stringify(manifest)}\n`, "utf8"),
    );
    return manifest;
  }
}

export function encryptedAuditArchiveFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): EncryptedAuditArchive {
  if (!env.AUDIT_ARCHIVE_DIR) {
    throw new Error("AUDIT_ARCHIVE_DIR is required.");
  }
  if (!env.AUDIT_ARCHIVE_KEY) {
    throw new Error("AUDIT_ARCHIVE_KEY is required.");
  }
  decodeKey(env.AUDIT_ARCHIVE_KEY);
  return new EncryptedAuditArchive({
    directory: env.AUDIT_ARCHIVE_DIR,
    keyBase64: env.AUDIT_ARCHIVE_KEY,
  });
}
