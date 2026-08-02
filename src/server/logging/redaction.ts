const REDACTED = "[REDACTED]";
const sensitiveKeyFragments = [
  "password",
  "token",
  "cookie",
  "authorization",
  "secret",
  "databaseurl",
  "connectionstring",
];

export function isSensitiveKey(key: string): boolean {
  const normalizedKey = key.replace(/[^a-z]/gi, "").toLowerCase();
  return sensitiveKeyFragments.some((fragment) => normalizedKey.includes(fragment));
}

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
      isSensitiveKey(key) ? REDACTED : redact(item),
    ]),
  );
}
