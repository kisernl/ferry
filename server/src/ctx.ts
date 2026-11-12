import type Database from "better-sqlite3";
import type { Config } from "@ferry/shared";
import type { makeGuard } from "./guard.js";
import type { GithubSetupService } from "./lib/githubSetupService.js";
import type { ParameterService } from "./lib/parameterService.js";

export interface Ctx {
  db: Database.Database;
  config: Config;
  params: ParameterService;
  github: GithubSetupService;
  guard: ReturnType<typeof makeGuard>;
}
