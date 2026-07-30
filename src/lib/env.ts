import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ORIGIN: z.url(),
  DATABASE_URL: z.string().min(1),
});

export type AppEnv = z.infer<typeof envSchema>;
export const parseEnv = (input: NodeJS.ProcessEnv): AppEnv => envSchema.parse(input);
export const getEnv = (): AppEnv => parseEnv(process.env);
