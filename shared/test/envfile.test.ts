import { describe, expect, it } from "vitest";
import { parseEnv, serializeEnv } from "../src/envfile.js";

function map(entries: { key: string; value: string }[]) {
  return Object.fromEntries(entries.map((e) => [e.key, e.value]));
}

describe("parseEnv", () => {
  it("parses KEY=value", () => {
    const r = parseEnv("A=1\nB=two\n");
    expect(map(r.entries)).toEqual({ A: "1", B: "two" });
  });

  it("parses export KEY=value", () => {
    expect(map(parseEnv("export A=1\n").entries)).toEqual({ A: "1" });
  });

  it("handles blank lines and comments", () => {
    const r = parseEnv("# heading\n\nA=1\n\n# trailing\n");
    expect(r.entries).toEqual([{ key: "A", value: "1" }]);
  });

  it("parses single-quoted values literally", () => {
    const r = parseEnv("A='hello world'\nB='\\n not newline'\n");
    expect(map(r.entries)).toEqual({ A: "hello world", B: "\\n not newline" });
  });

  it("parses double-quoted values and processes escapes", () => {
    const r = parseEnv('A="hello world"\nB="line1\\nline2"\nC="a\\"b"\nD="tab\\there"\n');
    expect(map(r.entries)).toEqual({
      A: "hello world",
      B: "line1\nline2",
      C: 'a"b',
      D: "tab\there",
    });
  });

  it("supports multiline double-quoted values", () => {
    const r = parseEnv('KEY="-----BEGIN-----\nabc123\n-----END-----"\nNEXT=1\n');
    expect(map(r.entries)).toEqual({
      KEY: "-----BEGIN-----\nabc123\n-----END-----",
      NEXT: "1",
    });
  });

  it("supports multiline single-quoted values", () => {
    const r = parseEnv("KEY='a\nb\nc'\n");
    expect(map(r.entries)).toEqual({ KEY: "a\nb\nc" });
  });

  it("strips inline comments after unquoted values", () => {
    const r = parseEnv("A=1 # comment\nB=foo#bar\n");
    expect(map(r.entries)).toEqual({ A: "1", B: "foo#bar" });
  });

  it("last duplicate wins and reports it", () => {
    const r = parseEnv("A=1\nB=2\nA=3\n");
    expect(map(r.entries)).toEqual({ A: "3", B: "2" });
    expect(r.duplicates).toEqual(["A"]);
  });

  it("handles empty and whitespace-only values", () => {
    const r = parseEnv("A=\nB=   \n");
    expect(map(r.entries)).toEqual({ A: "", B: "" });
  });

  it("warns on unparseable lines", () => {
    const r = parseEnv("NOT A LINE\nA=1\n");
    expect(r.warnings).toHaveLength(1);
    expect(map(r.entries)).toEqual({ A: "1" });
  });

  it("handles CRLF line endings", () => {
    const r = parseEnv("A=1\r\nB=2\r\n");
    expect(map(r.entries)).toEqual({ A: "1", B: "2" });
  });

  it("keeps unknown escapes literal in double quotes", () => {
    expect(map(parseEnv('A="x\\qy"\n').entries)).toEqual({ A: "x\\qy" });
  });
});

describe("serializeEnv", () => {
  it("writes simple values unquoted", () => {
    expect(serializeEnv([{ key: "A", value: "1" }])).toBe("A=1\n");
  });

  it("quotes values with spaces, #, quotes, newlines, backslashes", () => {
    const out = serializeEnv([
      { key: "A", value: "a b" },
      { key: "B", value: "x#y" },
      { key: "C", value: 'say "hi"' },
      { key: "D", value: "l1\nl2" },
      { key: "E", value: "a\\b" },
    ]);
    expect(out).toBe(
      'A="a b"\nB="x#y"\nC="say \\"hi\\""\nD="l1\\nl2"\nE="a\\\\b"\n',
    );
  });

  it("round-trips with parseEnv", () => {
    const original = [
      { key: "SIMPLE", value: "abc123" },
      { key: "SPACES", value: "hello world" },
      { key: "HASH", value: "x#y" },
      { key: "MULTI", value: "line1\nline2\nline3" },
      { key: "QUOTED", value: 'has "quotes" and \\backslash\\' },
      { key: "EMPTY", value: "" },
      { key: "TABS", value: "a\tb" },
    ];
    const text = serializeEnv(original);
    expect(parseEnv(text).entries).toEqual(original);
  });
});
