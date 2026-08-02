import {
  encryptedAuditArchiveFromEnv,
  type AuditArchive,
} from "./encrypted-audit-archive";
import {
  runMaintenance,
  type MaintenanceOptions,
  type MaintenanceResult,
} from "./maintenance.service";
import { MaintenanceFailure, maintenanceErrorCode } from "./maintenance-errors";

export { MaintenanceFailure } from "./maintenance-errors";

export type MaintenanceCliRuntime = {
  env: NodeJS.ProcessEnv;
  now: Date;
  execute?: (options: MaintenanceOptions) => Promise<MaintenanceResult>;
  onDatabaseAccess?: () => void;
  write: (message: string) => void;
  writeError: (message: string) => void;
};

export async function runMaintenanceCli(runtime: MaintenanceCliRuntime): Promise<number> {
  let auditArchive: AuditArchive;
  try {
    auditArchive = encryptedAuditArchiveFromEnv(runtime.env);
  } catch {
    runtime.write(`${JSON.stringify({ error: maintenanceErrorCode("CONFIG") })}\n`);
    return 1;
  }

  try {
    const execute = runtime.execute ?? runMaintenance;
    const result = await execute({
      now: runtime.now,
      auditArchive,
      onDatabaseAccess: runtime.execute === undefined ? runtime.onDatabaseAccess : undefined,
    });
    runtime.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    const category = error instanceof MaintenanceFailure ? error.category : "DATABASE";
    runtime.write(`${JSON.stringify({ error: maintenanceErrorCode(category) })}\n`);
    return 1;
  }
}
