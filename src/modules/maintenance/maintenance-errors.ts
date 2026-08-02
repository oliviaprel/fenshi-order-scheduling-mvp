export type MaintenanceFailureCategory = "CONFIG" | "DATABASE" | "ARCHIVE" | "DISCONNECT";

export class MaintenanceFailure extends Error {
  readonly code?: string;

  constructor(
    public readonly category: MaintenanceFailureCategory,
    options?: { cause?: unknown },
  ) {
    super(
      options?.cause instanceof Error
        ? options.cause.message
        : `Maintenance ${category.toLowerCase()} failure`,
      options,
    );
    this.name = "MaintenanceFailure";
    this.code =
      options?.cause instanceof Error && "code" in options.cause
        ? String(options.cause.code)
        : undefined;
  }
}

export function maintenanceErrorCode(category: MaintenanceFailureCategory): string {
  return `MAINTENANCE_${category}`;
}
