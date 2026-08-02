import {
  encryptedAuditArchiveFromEnv,
  type AuditArchive,
} from "./encrypted-audit-archive";
import {
  runMaintenance,
  type MaintenanceOptions,
  type MaintenanceResult,
} from "./maintenance.service";

export type MaintenanceCliRuntime = {
  env: NodeJS.ProcessEnv;
  now: Date;
  execute?: (options: MaintenanceOptions) => Promise<MaintenanceResult>;
  onDatabaseAccess?: () => void;
  write: (message: string) => void;
  writeError: (message: string) => void;
};

export async function runMaintenanceCli(runtime: MaintenanceCliRuntime): Promise<number> {
  try {
    const auditArchive: AuditArchive = encryptedAuditArchiveFromEnv(runtime.env);
    const execute = runtime.execute ?? runMaintenance;
    const result = await execute({
      now: runtime.now,
      auditArchive,
      onDatabaseAccess: runtime.execute === undefined ? runtime.onDatabaseAccess : undefined,
    });
    runtime.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch {
    runtime.write(`${JSON.stringify({ error: "MAINTENANCE_FAILED" })}\n`);
    return 1;
  }
}
