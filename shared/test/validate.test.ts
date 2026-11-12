import { describe, expect, it } from "vitest";
import {
  envPath,
  isValidKey,
  isValidSlug,
  isValidValue,
  keyFromParam,
  paramName,
  parseParamPath,
} from "../src/validate.js";

describe("naming rules", () => {
  it("accepts valid slugs", () => {
    for (const s of ["myapp", "a", "app-2", "x".repeat(63)]) {
      expect(isValidSlug(s)).toBe(true);
    }
  });

  it("rejects invalid slugs", () => {
    for (const s of ["", "A", "-lead", "a_b", "a b", "x".repeat(64), "UPPER"]) {
      expect(isValidSlug(s)).toBe(false);
    }
  });

  it("accepts valid keys", () => {
    for (const k of ["A", "_X", "DATABASE_URL", "k9", "K".repeat(255)]) {
      expect(isValidKey(k)).toBe(true);
    }
  });

  it("rejects invalid keys", () => {
    for (const k of ["", "9K", "K-NAME", "K.NAME", "K NAME", "K".repeat(256)]) {
      expect(isValidKey(k)).toBe(false);
    }
  });

  it("enforces 4KB value limit and non-empty", () => {
    expect(isValidValue("x".repeat(4096))).toBe(true);
    expect(isValidValue("x".repeat(4097))).toBe(false);
    expect(isValidValue("")).toBe(false);
    // multibyte chars count as bytes
    expect(isValidValue("é".repeat(2049))).toBe(false);
  });
});

describe("paths", () => {
  it("builds env paths and param names", () => {
    expect(envPath("ferry", "myapp", "production")).toBe("/ferry/myapp/production");
    expect(paramName("ferry", "myapp", "production", "API_KEY")).toBe(
      "/ferry/myapp/production/API_KEY",
    );
  });

  it("extracts keys and parses param paths", () => {
    expect(keyFromParam("/ferry/a/b/MY_KEY")).toBe("MY_KEY");
    expect(parseParamPath("ferry", "/ferry/app/prod/KEY")).toEqual({
      project: "app",
      env: "prod",
      key: "KEY",
    });
  });

  it("rejects paths outside the prefix or with bad segments", () => {
    expect(parseParamPath("ferry", "/other/app/prod/KEY")).toBeNull();
    expect(parseParamPath("ferry", "/ferry/app/prod")).toBeNull();
    expect(parseParamPath("ferry", "/ferry/app/prod/KEY/extra")).toBeNull();
    expect(parseParamPath("ferry", "/ferry/Bad/prod/KEY")).toBeNull();
  });
});
