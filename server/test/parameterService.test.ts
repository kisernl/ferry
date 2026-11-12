import { describe, expect, it, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  DescribeParametersCommand,
  GetParameterCommand,
  GetParametersByPathCommand,
  PutParameterCommand,
  SSMClient,
} from "@aws-sdk/client-ssm";
import { ParameterService } from "../src/lib/parameterService.js";

const ssm = new SSMClient({ region: "us-east-1" });
const ssmMock = mockClient(ssm);
const svc = new ParameterService(ssm, "ferry");

beforeEach(() => ssmMock.reset());

describe("listEnv", () => {
  it("paginates DescribeParameters and returns metadata only", async () => {
    ssmMock
      .on(DescribeParametersCommand)
      .resolvesOnce({
        Parameters: [
          { Name: "/ferry/app/prod/A", Version: 1 },
          { Name: "/ferry/app/prod/B", Version: 2 },
        ],
        NextToken: "t2",
      })
      .resolvesOnce({
        Parameters: [{ Name: "/ferry/app/prod/C", Version: 1 }],
      });
    const keys = await svc.listEnv("app", "prod");
    expect(keys.map((k) => k.key)).toEqual(["A", "B", "C"]);
    expect(ssmMock.commandCalls(DescribeParametersCommand)).toHaveLength(2);
  });
});

describe("put", () => {
  it("tags only on first create", async () => {
    // currentVersion → not found → create with tags
    ssmMock
      .on(GetParameterCommand)
      .rejectsOnce(Object.assign(new Error("nf"), { name: "ParameterNotFound" }))
      .rejectsOnce(Object.assign(new Error("nf"), { name: "ParameterNotFound" }));
    ssmMock.on(PutParameterCommand).resolves({ Version: 1 });
    await svc.put("app", "prod", "KEY", "v", {
      tags: { "managed-by": "ferry" },
    });
    const call = ssmMock.commandCalls(PutParameterCommand)[0]!;
    expect(call.args[0].input.Tags).toEqual([
      { Key: "managed-by", Value: "ferry" },
    ]);
    expect(call.args[0].input.Type).toBe("SecureString");
    expect(call.args[0].input.Tier).toBe("Standard");
  });

  it("omits tags on update", async () => {
    ssmMock.on(GetParameterCommand).resolves({
      Parameter: { Name: "/ferry/app/prod/K", Version: 3 },
    });
    ssmMock.on(PutParameterCommand).resolves({ Version: 4 });
    await svc.put("app", "prod", "K", "v", { tags: { a: "b" } });
    expect(
      ssmMock.commandCalls(PutParameterCommand)[0]!.args[0].input.Tags,
    ).toBeUndefined();
  });

  it("returns VERSION_CONFLICT on stale expectedVersion", async () => {
    ssmMock.on(GetParameterCommand).resolves({
      Parameter: { Name: "/ferry/app/prod/K", Version: 5 },
    });
    await expect(
      svc.put("app", "prod", "K", "v", { expectedVersion: 4 }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT", statusCode: 409 });
    expect(ssmMock.commandCalls(PutParameterCommand)).toHaveLength(0);
  });
});

describe("getAllValues", () => {
  it("decrypts via GetParametersByPath and paginates", async () => {
    ssmMock
      .on(GetParametersByPathCommand)
      .resolvesOnce({
        Parameters: [{ Name: "/ferry/app/prod/A", Value: "1" }],
        NextToken: "x",
      })
      .resolvesOnce({
        Parameters: [{ Name: "/ferry/app/prod/B", Value: "2" }],
      });
    const values = await svc.getAllValues("app", "prod");
    expect(Object.fromEntries(values)).toEqual({ A: "1", B: "2" });
    const calls = ssmMock.commandCalls(GetParametersByPathCommand);
    expect(calls[0]!.args[0].input.WithDecryption).toBe(true);
  });
});

describe("throttling", () => {
  it("retries ThrottlingException with backoff", async () => {
    ssmMock
      .on(GetParameterCommand)
      .rejectsOnce(Object.assign(new Error("t"), { name: "ThrottlingException" }))
      .rejectsOnce(Object.assign(new Error("t"), { name: "ThrottlingException" }))
      .resolves({ Parameter: { Name: "n", Value: "v", Version: 1 } });
    const res = await svc.reveal("app", "prod", "K");
    expect(res.value).toBe("v");
    expect(ssmMock.commandCalls(GetParameterCommand)).toHaveLength(3);
  }, 15000);
});
