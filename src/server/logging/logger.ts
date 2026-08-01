import { redact } from "./redaction";

type LogLevel = "info" | "warn" | "error";

type LogContext = Record<string, unknown> & {
  requestId: string;
};

type LoggerOptions = {
  environment?: string;
  now?: () => Date;
  write?: (line: string) => void;
};

export type Logger = Record<LogLevel, (message: string, context: LogContext) => void>;

function omitRequestBodies(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => omitRequestBodies(item));
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !["body", "requestbody"].includes(key.toLowerCase()))
      .map(([key, item]) => [key, omitRequestBodies(item)]),
  );
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const environment = options.environment ?? process.env.NODE_ENV ?? "development";
  const now = options.now ?? (() => new Date());
  const write = options.write ?? ((line: string) => console.log(line));

  const log = (level: LogLevel, message: string, context: LogContext): void => {
    const { requestId, ...contextFields } = context;
    const safeContext =
      environment === "production" ? omitRequestBodies(contextFields) : contextFields;

    write(
      JSON.stringify({
        ...(redact(safeContext) as Record<string, unknown>),
        timestamp: now().toISOString(),
        level,
        message,
        requestId,
      }),
    );
  };

  return {
    info: (message, context) => log("info", message, context),
    warn: (message, context) => log("warn", message, context),
    error: (message, context) => log("error", message, context),
  };
}

export const logger = createLogger();
