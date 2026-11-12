import type Database from "better-sqlite3";
import type { ParameterService } from "./parameterService.js";

/** Sync projects/environments found under the SSM prefix into SQLite. */
export function rescan(
  db: Database.Database,
  params: ParameterService,
  protectedDefaults: Set<string>,
): Promise<{ added: { project: string; env: string }[] }> {
  return params.scanPrefix().then((found) => {
    const added: { project: string; env: string }[] = [];
    const upsertProject = db.prepare(
      "INSERT OR IGNORE INTO projects (name) VALUES (?)",
    );
    const upsertEnv = db.prepare(
      "INSERT OR IGNORE INTO environments (project, name, protected) VALUES (?, ?, ?)",
    );
    const exists = db.prepare(
      "SELECT 1 FROM environments WHERE project = ? AND name = ?",
    );
    db.transaction(() => {
      for (const { project, env } of found) {
        upsertProject.run(project);
        if (!exists.get(project, env)) {
          upsertEnv.run(project, env, protectedDefaults.has(env) ? 1 : 0);
          added.push({ project, env });
        }
      }
    })();
    return { added };
  });
}
