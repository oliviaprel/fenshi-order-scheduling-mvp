import { unlink } from "node:fs/promises";
import { disabledSessionStatePath } from "./global-setup";

export default async function globalTeardown(): Promise<void> {
  await unlink(disabledSessionStatePath).catch(() => undefined);
}
