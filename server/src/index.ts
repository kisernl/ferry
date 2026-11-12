import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { SSMClient } from "@aws-sdk/client-ssm";
import { loadConfig, protectedEnvDefaults } from "./config.js";
import { openDb, pruneAuditLog } from "./db.js";
import { buildApp } from "./app.js";
import { ParameterService } from "./lib/parameterService.js";
import { rescan } from "./lib/rescan.js";

const config = loadConfig();
const db = openDb(config.DATA_DIR);
pruneAuditLog(db);

// Docker: /app/dist → /app/web/dist; dev or local build: server/{src,dist} → repo/web/dist
const staticDir = ["../web/dist", "../../web/dist"]
  .map((p) => resolve(import.meta.dirname, p))
  .find((p) => existsSync(p));

const app = await buildApp({
  config,
  db,
  ...(staticDir ? { staticDir } : {}),
});

// Best-effort rescan of the SSM prefix at startup.
const params = new ParameterService(
  new SSMClient({ region: config.AWS_REGION }),
  config.FERRY_PREFIX,
  config.KMS_KEY_ID,
);
rescan(db, params, protectedEnvDefaults(config)).catch((err) => {
  app.log.warn({ err }, "startup rescan failed (AWS credentials may not be ready)");
});

app.listen({ port: config.PORT, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
