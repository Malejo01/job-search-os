import { confirmRemoteTarget, type Db } from "@job-search-os/db";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { maskEmail, parseEmail, remoteConfirmOptions } from "./common";
import { parseInviteArgs } from "./invite";
import { loadReplayFixture, parseReplayArgs, ReplayFixtureSchema } from "./replay";
import { parseAllowlist, parseTestUsersArgs, readAllowlist, resetTestUser } from "./test-users";
import {
  fileCredentialStore,
  formatCreateRow,
  generatePassword,
  readTermsVersion,
} from "./test-users-create";

const here = dirname(fileURLToPath(import.meta.url));

describe("confirmación remota", () => {
  it("CONFIRM_PRODUCTION=si no saltea la pregunta: sin terminal, no confirma", async () => {
    const before = process.env.CONFIRM_PRODUCTION;
    process.env.CONFIRM_PRODUCTION = "si";
    try {
      const ok = await confirmRemoteTarget("postgres://u@db.example.com/x", {
        ...remoteConfirmOptions("probar", () => {}),
        interactive: false,
      });
      expect(ok).toBe(false);
    } finally {
      if (before === undefined) delete process.env.CONFIRM_PRODUCTION;
      else process.env.CONFIRM_PRODUCTION = before;
    }
  });
});

describe("resetTestUser sin base", () => {
  // Los rechazos ocurren antes de tocar la base
  const noDb = {} as Db;
  it("rechaza un email de ADMIN_EMAILS aunque esté en la allowlist", async () => {
    const r = await resetTestUser(
      noDb,
      "Admin@Example.com",
      ["admin@example.com"],
      "admin@example.com",
    );
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("admin") });
  });
  it("rechaza un email fuera de la allowlist", async () => {
    const r = await resetTestUser(noDb, "otro@example.com", ["prueba@example.com"], "");
    expect(r.ok).toBe(false);
  });
});

describe("maskEmail / parseEmail", () => {
  it("enmascara dejando la primera letra y el dominio", () => {
    expect(maskEmail("lucia@example.com")).toBe("l***@example.com");
  });
  it("lo que no es un email sale como ***", () => {
    expect(maskEmail("sin-arroba")).toBe("***");
    expect(maskEmail("@example.com")).toBe("***");
    expect(maskEmail("ana@")).toBe("***");
  });
  it("parseEmail normaliza y rechaza lo inválido", () => {
    expect(parseEmail("  Ana@Example.COM ")).toBe("ana@example.com");
    expect(parseEmail("no-es-email")).toBeNull();
    expect(parseEmail(undefined)).toBeNull();
  });
});

describe("parseInviteArgs", () => {
  it("--by obligatorio; --email y --remote opcionales", () => {
    expect(parseInviteArgs(["--by", "Admin@Example.com"])).toEqual({
      ok: true,
      by: "admin@example.com",
      email: null,
      remote: false,
    });
    expect(
      parseInviteArgs(["--by", "admin@example.com", "--email", "Nueva@Example.com", "--remote"]),
    ).toEqual({ ok: true, by: "admin@example.com", email: "nueva@example.com", remote: true });
  });
  it("rechaza sin --by, email inválido y opciones desconocidas", () => {
    expect(parseInviteArgs([]).ok).toBe(false);
    expect(parseInviteArgs(["--by", "x"]).ok).toBe(false);
    expect(parseInviteArgs(["--by", "a@example.com", "--email", "x"]).ok).toBe(false);
    expect(parseInviteArgs(["--by", "a@example.com", "--otra"]).ok).toBe(false);
  });
});

describe("parseTestUsersArgs", () => {
  it("--list con defaults", () => {
    expect(parseTestUsersArgs(["--list"])).toEqual({
      ok: true,
      mode: { kind: "list" },
      allowlist: "ops/test-users.txt",
      showEmails: false,
      yes: false,
      remote: false,
    });
  });
  it("--reset con todas las opciones", () => {
    expect(
      parseTestUsersArgs([
        "--reset",
        "Prueba@Example.com",
        "--allowlist",
        "mi.txt",
        "--yes",
        "--remote",
        "--show-emails",
      ]),
    ).toEqual({
      ok: true,
      mode: { kind: "reset", email: "prueba@example.com" },
      allowlist: "mi.txt",
      showEmails: true,
      yes: true,
      remote: true,
    });
  });
  it("exige un modo, no admite los dos y valida el email", () => {
    expect(parseTestUsersArgs([]).ok).toBe(false);
    expect(parseTestUsersArgs(["--list", "--reset", "a@example.com"]).ok).toBe(false);
    expect(parseTestUsersArgs(["--reset", "no-es-email"]).ok).toBe(false);
  });
});

describe("parseTestUsersArgs: --create y --reset-all (T-1)", () => {
  it("--create exige --by y trae la ruta de credenciales por defecto", () => {
    expect(parseTestUsersArgs(["--create", "--by", "Admin@Example.com"])).toEqual({
      ok: true,
      mode: {
        kind: "create",
        by: "admin@example.com",
        credentials: "ops/test-users-credenciales.json",
      },
      allowlist: "ops/test-users.txt",
      showEmails: false,
      yes: false,
      remote: false,
    });
    expect(parseTestUsersArgs(["--create"]).ok).toBe(false);
    expect(parseTestUsersArgs(["--create", "--by", "no-es-email"]).ok).toBe(false);
  });
  it("--reset-all es un modo más y no se combina con los otros", () => {
    expect(parseTestUsersArgs(["--reset-all"])).toMatchObject({
      ok: true,
      mode: { kind: "reset-all" },
    });
    expect(parseTestUsersArgs(["--reset-all", "--list"]).ok).toBe(false);
    expect(parseTestUsersArgs(["--reset-all", "--create", "--by", "a@example.com"]).ok).toBe(false);
    expect(parseTestUsersArgs(["--reset-all", "--reset", "a@example.com"]).ok).toBe(false);
  });
  it("--credentials solo acepta rutas relativas bajo ops/, sin «..»", () => {
    const create = (p: string) =>
      parseTestUsersArgs(["--create", "--by", "a@example.com", "--credentials", p]);
    expect(create("ops/otra.json").ok).toBe(true);
    expect(create("ops/sub/otra.json").ok).toBe(true);
    for (const bad of [
      "otra.json",
      "ops/../x.json",
      "../ops/x.json",
      "/etc/x.json",
      "C:/x.json",
      "ops",
      "docs/x.json",
      "ops\\..\\x.json",
    ]) {
      expect(create(bad).ok, bad).toBe(false);
    }
  });
  it("--force es solo de --reset y queda en el modo", () => {
    expect(parseTestUsersArgs(["--reset", "a@example.com", "--force"])).toMatchObject({
      ok: true,
      mode: { kind: "reset", email: "a@example.com", force: true },
    });
    expect(parseTestUsersArgs(["--reset-all", "--force"]).ok).toBe(false);
    expect(parseTestUsersArgs(["--list", "--force"]).ok).toBe(false);
  });
  it("--by y --credentials solo valen con --create", () => {
    expect(parseTestUsersArgs(["--list", "--by", "a@example.com"]).ok).toBe(false);
    expect(parseTestUsersArgs(["--reset-all", "--credentials", "x.json"]).ok).toBe(false);
  });
});

describe("test-users --create: piezas sin base", () => {
  it("la contraseña es aleatoria y fuerte (32 caracteres base64url, distinta cada vez)", () => {
    const a = generatePassword();
    const b = generatePassword();
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(a).not.toBe(b);
  });

  it("la línea de resultado enmascara el email y nunca trae contraseñas", () => {
    const line = formatCreateRow({ email: "uno@example.com", status: "creada" }, false);
    expect(line).toBe("u***@example.com  creada");
    expect(formatCreateRow({ email: "uno@example.com", status: "ya existe" }, true)).toBe(
      "uno@example.com  ya existe",
    );
  });

  it("lee la versión de términos de apps/web/lib/terms.ts (guarda contra un cambio de formato)", () => {
    const real = readTermsVersion({ INIT_CWD: resolve(here, "../../../..") });
    expect(real).toMatchObject({ ok: true, version: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    const fake = readTermsVersion(
      { INIT_CWD: "/x" },
      () => 'export const TERMS_VERSION = "2030-01-02";',
    );
    expect(fake).toEqual({ ok: true, version: "2030-01-02" });
    expect(readTermsVersion({ INIT_CWD: "/x" }, () => "nada").ok).toBe(false);
  });

  it("el store de archivo guarda, no duplica y borra sin tocar a las demás", () => {
    const dir = mkdtempSync(join(tmpdir(), "creds-"));
    try {
      const store = fileCredentialStore("c.json", { INIT_CWD: dir });
      store.save("Uno@Example.com", "clave-uno", new Date("2026-11-13T00:00:00Z"));
      store.save("dos@example.com", "clave-dos", new Date("2026-11-13T00:00:00Z"));
      expect(store.has("uno@example.com")).toBe(true);
      store.drop("uno@example.com");
      const data = JSON.parse(readFileSync(join(dir, "c.json"), "utf8"));
      expect(Object.keys(data.accounts)).toEqual(["dos@example.com"]);
      expect(data.accounts["dos@example.com"].password).toBe("clave-dos");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("docs/beta/test-users.example.txt: 17 emails válidos, únicos y en el dominio reservado", () => {
    const text = readFileSync(
      resolve(here, "../../../../docs/beta/test-users.example.txt"),
      "utf8",
    );
    const emails = parseAllowlist(text);
    expect(emails).toHaveLength(17);
    expect(emails.every((e) => e.endsWith("@example.com"))).toBe(true);
    expect(emails).toContain("auditoria@example.com");
    const careers = new Set(
      emails.map((e) => e.split("@")[0]!.replace(/-(junior|con-experiencia)$/, "")),
    );
    expect(careers.size).toBe(9); // auditoría + las 8 carreras
  });
});

describe("allowlist", () => {
  it("normaliza mayúsculas y espacios, ignora comentarios, vacías y basura, sin duplicar", () => {
    const text =
      "# cuentas de prueba\n  Uno@Example.com  \r\n\ndos@example.com # nota\nbasura\nuno@example.com\n";
    expect(parseAllowlist(text)).toEqual(["uno@example.com", "dos@example.com"]);
  });
  it("inexistente o vacía → error", () => {
    const missing = readAllowlist("nada.txt", { INIT_CWD: "/x" }, () => {
      throw new Error("ENOENT");
    });
    expect(missing.ok).toBe(false);
    const empty = readAllowlist("vacia.txt", { INIT_CWD: "/x" }, () => "# solo comentarios\n\n");
    expect(empty.ok).toBe(false);
  });
  it("resuelve la ruta desde INIT_CWD", () => {
    let seen = "";
    const res = readAllowlist("ops/test-users.txt", { INIT_CWD: "/raiz" }, (p) => {
      seen = p.replace(/\\/g, "/");
      return "a@example.com";
    });
    expect(res).toEqual({ ok: true, emails: ["a@example.com"] });
    expect(seen).toMatch(/\/raiz\/ops\/test-users\.txt$/);
  });
});

describe("parseReplayArgs", () => {
  it("fixture posicional y --to", () => {
    expect(parseReplayArgs(["f.json", "--to", "Ana@Example.com"])).toEqual({
      ok: true,
      fixture: "f.json",
      to: "ana@example.com",
      remote: false,
    });
  });
  it("rechaza sin fixture, sin --to o con posicionales de más", () => {
    expect(parseReplayArgs(["--to", "a@example.com"]).ok).toBe(false);
    expect(parseReplayArgs(["f.json"]).ok).toBe(false);
    expect(parseReplayArgs(["f.json", "g.json", "--to", "a@example.com"]).ok).toBe(false);
  });
});

describe("ReplayFixtureSchema / loadReplayFixture", () => {
  const base = { from: "A <a@example.com>", subject: "Hola" };
  it("acepta html o htmlFile, no ambos ni ninguno", () => {
    expect(ReplayFixtureSchema.safeParse({ ...base, html: "<p>x</p>" }).success).toBe(true);
    expect(ReplayFixtureSchema.safeParse({ ...base, htmlFile: "x.html" }).success).toBe(true);
    expect(ReplayFixtureSchema.safeParse(base).success).toBe(false);
    expect(ReplayFixtureSchema.safeParse({ ...base, html: "x", htmlFile: "y" }).success).toBe(
      false,
    );
  });
  it("rechaza campos desconocidos y faltantes", () => {
    expect(ReplayFixtureSchema.safeParse({ ...base, html: "x", extra: 1 }).success).toBe(false);
    expect(ReplayFixtureSchema.safeParse({ subject: "s", html: "x" }).success).toBe(false);
  });
  it("lee htmlFile relativo al JSON y da error claro con JSON inválido", () => {
    const files: Record<string, string> = {
      "/r/fx/a.json": JSON.stringify({ ...base, htmlFile: "../h/x.html" }),
      "/r/h/x.html": "<p>hola</p>",
      "/r/fx/mal.json": "{no es json",
    };
    const read = (p: string) => {
      const v = files[p.replace(/\\/g, "/").replace(/^[A-Za-z]:/, "")];
      if (v === undefined) throw new Error("ENOENT");
      return v;
    };
    const ok = loadReplayFixture("fx/a.json", { INIT_CWD: "/r" }, read);
    expect(ok).toMatchObject({ ok: true, loaded: { html: "<p>hola</p>" } });
    const bad = loadReplayFixture("fx/mal.json", { INIT_CWD: "/r" }, read);
    expect(bad).toMatchObject({ ok: false, error: expect.stringContaining("JSON") });
  });
  it("htmlFile solo lee .html y nunca desde fixtures-private", () => {
    const files: Record<string, string> = {
      "/r/fx/env.json": JSON.stringify({ ...base, htmlFile: "../.env" }),
      "/r/fx/priv.json": JSON.stringify({ ...base, htmlFile: "../fixtures-private/x.html" }),
      "/r/.env": "SECRETO=1",
      "/r/fixtures-private/x.html": "<p>privado</p>",
    };
    const read = (p: string) => {
      const v = files[p.replace(/\\/g, "/").replace(/^[A-Za-z]:/, "")];
      if (v === undefined) throw new Error("ENOENT");
      return v;
    };
    for (const name of ["fx/env.json", "fx/priv.json"]) {
      expect(loadReplayFixture(name, { INIT_CWD: "/r" }, read)).toMatchObject({
        ok: false,
        error: expect.stringContaining(".html público"),
      });
    }
  });
});
