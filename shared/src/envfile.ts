/** .env parser and serializer. Handles: KEY=value, export KEY=value,
 *  single- and double-quoted values, escapes in double quotes, multiline
 *  quoted values, # comments, blank lines, inline comments after unquoted
 *  values. Duplicate keys: last wins, reported in `duplicates`. */

export interface EnvEntry {
  key: string;
  value: string;
}

export interface ParseResult {
  entries: EnvEntry[];
  duplicates: string[];
  warnings: string[];
}

const KEY_AT_START = /^([A-Za-z_][A-Za-z0-9_]{0,254})\s*=\s*/;

const ESCAPES: Record<string, string> = {
  n: "\n",
  r: "\r",
  t: "\t",
  '"': '"',
  "'": "'",
  "\\": "\\",
  $: "$",
  "`": "`",
};

export function parseEnv(text: string): ParseResult {
  const lines = text.split("\n");
  const values = new Map<string, string>();
  const order: string[] = [];
  const duplicates = new Set<string>();
  const warnings: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const lineNo = i + 1;
    let line = lines[i]!.replace(/\r$/, "").trim();
    i++;

    if (!line || line.startsWith("#")) continue;
    line = line.replace(/^export\s+/, "");

    const m = KEY_AT_START.exec(line);
    if (!m) {
      warnings.push(`line ${lineNo}: ignored (not KEY=value)`);
      continue;
    }
    const key = m[1]!;
    const rest = line.slice(m[0].length);
    let value = "";

    if (rest.startsWith("'")) {
      let buf = rest.slice(1);
      let closed = false;
      for (;;) {
        const j = buf.indexOf("'");
        if (j >= 0) {
          value += buf.slice(0, j);
          closed = true;
          break;
        }
        if (i >= lines.length) break;
        value += buf + "\n";
        buf = lines[i]!.replace(/\r$/, "");
        i++;
      }
      if (!closed) warnings.push(`line ${lineNo}: unterminated single quote`);
    } else if (rest.startsWith('"')) {
      let buf = rest.slice(1);
      let closed = false;
      outer: for (;;) {
        let k = 0;
        while (k < buf.length) {
          const c = buf[k]!;
          if (c === "\\" && k + 1 < buf.length) {
            value += ESCAPES[buf[k + 1]!] ?? `\\${buf[k + 1]!}`;
            k += 2;
            continue;
          }
          if (c === '"') {
            closed = true;
            break outer;
          }
          value += c;
          k++;
        }
        if (i >= lines.length) break;
        value += "\n";
        buf = lines[i]!.replace(/\r$/, "");
        i++;
      }
      if (!closed) warnings.push(`line ${lineNo}: unterminated double quote`);
    } else {
      const commentAt = rest.search(/\s#/);
      value = (commentAt >= 0 ? rest.slice(0, commentAt) : rest).trimEnd();
    }

    if (values.has(key)) duplicates.add(key);
    else order.push(key);
    values.set(key, value);
  }

  return {
    entries: order.map((key) => ({ key, value: values.get(key)! })),
    duplicates: [...duplicates],
    warnings,
  };
}

const NEEDS_QUOTING = /[\s#'"\\]/;

export function serializeEnv(entries: EnvEntry[]): string {
  return (
    entries
      .map(({ key, value }) => {
        if (value === "" || NEEDS_QUOTING.test(value)) {
          const esc = value
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"')
            .replace(/\n/g, "\\n")
            .replace(/\r/g, "\\r")
            .replace(/\t/g, "\\t");
          return `${key}="${esc}"`;
        }
        return `${key}=${value}`;
      })
      .join("\n") + "\n"
  );
}
