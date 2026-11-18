import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const COMPOSE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../infra/docker-compose.yml",
);

/** Puertos publicados, en las dos formas de YAML: `ports: ["a:b"]` y una lista con `- "a:b"`. */
function publishedPorts(yaml: string): string[] {
  const ports: string[] = [];
  let inList = false;
  for (const raw of yaml.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trimEnd();
    const inline = /^\s*ports:\s*\[(.*)\]\s*$/.exec(line);
    if (inline) {
      ports.push(...inline[1]!.split(",").map((p) => p.trim().replace(/^["']|["']$/g, "")));
      inList = false;
    } else if (/^\s*ports:\s*$/.test(line)) {
      inList = true;
    } else if (inList && /^\s*-\s*/.test(line)) {
      ports.push(line.replace(/^\s*-\s*/, "").replace(/^["']|["']$/g, ""));
    } else if (line.trim()) {
      inList = false;
    }
  }
  return ports.filter(Boolean);
}

describe("infra/docker-compose.yml", () => {
  it("publica cada puerto solo en loopback", () => {
    const ports = publishedPorts(readFileSync(COMPOSE, "utf8"));

    expect(ports.length).toBeGreaterThan(0);
    expect(ports.filter((p) => !p.startsWith("127.0.0.1:"))).toEqual([]);
  });

  it("no deja contraseñas escritas en el archivo", () => {
    const passwords = readFileSync(COMPOSE, "utf8")
      .split(/\r?\n/)
      .filter((line) => /^\s*POSTGRES_PASSWORD:/.test(line));

    expect(passwords).toHaveLength(2);
    for (const line of passwords) expect(line).toMatch(/POSTGRES_PASSWORD: \$\{[A-Z_]+:-/);
  });

  it("separa el snapshot en otro servicio, con otra contraseña y otro puerto", () => {
    const yaml = readFileSync(COMPOSE, "utf8");

    expect(yaml).toContain("container_name: jso-snapshot");
    expect(yaml).toContain("profiles: [snapshot]");
    expect(yaml).toContain("127.0.0.1:54323:5432");
    expect(yaml).toContain("${JSO_LOCAL_DB_PASSWORD:-postgres}");
    expect(yaml).toContain("${JSO_SNAPSHOT_DB_PASSWORD:-}");
  });
});

describe("publishedPorts", () => {
  it("lee las dos formas de YAML e ignora los comentarios", () => {
    const yaml = [
      'ports: ["54322:5432", "127.0.0.1:1:1"]',
      "# ports: ['9:9']",
      "ports:",
      '  - "4566:4566"',
      "  - 127.0.0.1:2:2",
      "environment:",
      "  - NO_ES_PUERTO=1",
    ].join("\n");

    expect(publishedPorts(yaml)).toEqual([
      "54322:5432",
      "127.0.0.1:1:1",
      "4566:4566",
      "127.0.0.1:2:2",
    ]);
  });
});
