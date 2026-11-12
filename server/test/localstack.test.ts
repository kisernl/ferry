/** Integration test against LocalStack SSM. Runs only when
 *  FERRY_TEST_LOCALSTACK=1 (CI provides a LocalStack service container). */
import { describe, expect, it, beforeAll } from "vitest";
import { SSMClient } from "@aws-sdk/client-ssm";
import { ParameterService } from "../src/lib/parameterService.js";

const RUN = process.env.FERRY_TEST_LOCALSTACK === "1";
const endpoint = process.env.LOCALSTACK_ENDPOINT ?? "http://localhost:4566";

const ssm = new SSMClient({
  region: "us-east-1",
  endpoint,
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
});
const svc = new ParameterService(ssm, "ferry-it");

describe.skipIf(!RUN)("LocalStack SSM", () => {
  beforeAll(async () => {
    // seed one key outside the app to prove rescan-style listing works
    await svc.put("seedproj", "staging", "SEEDED", "v1");
  });

  it("puts, gets, lists, histories and deletes under a test prefix", async () => {
    await svc.put("itproj", "production", "API_KEY", "first");
    const { value, version } = await svc.reveal("itproj", "production", "API_KEY");
    expect(value).toBe("first");
    expect(version).toBeGreaterThanOrEqual(1);

    await svc.put("itproj", "production", "API_KEY", "second");
    const hist = await svc.history("itproj", "production", "API_KEY");
    expect(hist.length).toBeGreaterThanOrEqual(2);
    const old = await svc.revealVersion("itproj", "production", "API_KEY", hist[hist.length - 1]!.version);
    expect(old).toBe("first");

    const keys = await svc.listEnv("itproj", "production");
    expect(keys.map((k) => k.key)).toContain("API_KEY");

    const scan = await svc.scanPrefix();
    expect(scan).toContainEqual({ project: "seedproj", env: "staging" });
    expect(scan).toContainEqual({ project: "itproj", env: "production" });

    const all = await svc.getAllValues("itproj", "production");
    expect(all.get("API_KEY")).toBe("second");

    await svc.delete("itproj", "production", "API_KEY");
    expect(await svc.currentVersion("itproj", "production", "API_KEY")).toBeNull();
  });

  it("import-style bulk put with concurrency works", async () => {
    const entries = Array.from({ length: 12 }, (_, i) => ({
      key: `BULK_${i}`,
      value: `v${i}`,
    }));
    const results = await svc.putMany("itproj", "staging", entries);
    expect(results.every((r) => r.ok)).toBe(true);
    const all = await svc.getAllValues("itproj", "staging");
    expect(all.get("BULK_11")).toBe("v11");
    await svc.deleteAllUnder("/ferry-it/");
  });
});
