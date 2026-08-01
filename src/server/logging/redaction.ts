const REDACTED = "[REDACTED]";
const sensitiveKeys = new Set([
  "password",
  "passwordhash",
  "token",
  "tokenhash",
  "cookie",
  "authorization",
  "databaseurl",
]);

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      sensitiveKeys.has(key.toLowerCase()) ? REDACTED : redact(item),
    ]),
  );
}
