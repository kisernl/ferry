import { configSchema, type Config } from "@ferry/shared";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    console.error(`ferry: invalid configuration\n${problems}`);
    process.exit(1);
  }
  return result.data;
}

export function adminLogins(config: Config): Set<string> {
  return new Set(
    config.ADMIN_GITHUB_USERS.split(",").map((s) => s.trim().toLowerCase()),
  );
}

export function allowedUserLogins(config: Config): Set<string> {
  return new Set(
    (config.ALLOWED_GITHUB_USERS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function protectedEnvDefaults(config: Config): Set<string> {
  return new Set(
    config.PROTECTED_ENVS.split(",").map((s) => s.trim()).filter(Boolean),
  );
}
