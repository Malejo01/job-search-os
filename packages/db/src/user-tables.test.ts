import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "../schema";
import { hashPassword } from "./password";
import {
  OWNER_COLUMNS,
  USER_TABLES,
  confirmsAccountDeletion,
  usersTableIsLast,
} from "./user-tables";

const schemaTables = Object.values(schema as Record<string, unknown>)
  .filter((t): t is PgTable => is(t, PgTable))
  .map((t) => getTableConfig(t));

const key = (table: string, column: string) => `${table}.${column}`;

describe("confirmsAccountDeletion", () => {
  const user = { email: "Persona@Example.test", passwordHash: hashPassword("clave-de-prueba-1") };

  it("acepta email (sin importar mayúsculas ni espacios) y contraseña correctos", () => {
    expect(
      confirmsAccountDeletion(user, {
        email: " persona@example.test ",
        password: "clave-de-prueba-1",
      }),
    ).toBe(true);
  });

  it("rechaza contraseña incorrecta, email ajeno o vacío y usuario inexistente", () => {
    const ok = "clave-de-prueba-1";
    expect(
      confirmsAccountDeletion(user, { email: "persona@example.test", password: "otra-clave-2" }),
    ).toBe(false);
    expect(confirmsAccountDeletion(user, { email: "otra@example.test", password: ok })).toBe(false);
    expect(confirmsAccountDeletion(user, { email: "", password: ok })).toBe(false);
    expect(
      confirmsAccountDeletion(undefined, { email: "persona@example.test", password: ok }),
    ).toBe(false);
  });
});

describe("USER_TABLES (borrado de cuenta, JS-092)", () => {
  it("cubre toda tabla del schema con columna de dueño (una tabla nueva sin borrado rompe el CI)", () => {
    const listed = new Set(USER_TABLES.map((e) => key(e.table, e.column)));
    const missing: string[] = [];
    for (const t of schemaTables) {
      for (const c of t.columns) {
        if (
          (OWNER_COLUMNS as readonly string[]).includes(c.name) &&
          !listed.has(key(t.name, c.name))
        ) {
          missing.push(key(t.name, c.name));
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("toda entrada de la lista existe en el schema (tabla y columna)", () => {
    const real = new Set(schemaTables.flatMap((t) => t.columns.map((c) => key(t.name, c.name))));
    expect(USER_TABLES.map((e) => key(e.table, e.column)).filter((k) => !real.has(k))).toEqual([]);
  });

  it("no repite entradas", () => {
    const keys = USER_TABLES.map((e) => key(e.table, e.column) + e.action);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("`users` no está en la lista: se borra siempre al final", () => {
    expect(USER_TABLES.some((e) => e.table === "users")).toBe(false);
    expect(usersTableIsLast.table).toBe("users");
    expect(schemaTables.some((t) => t.name === "users")).toBe(true);
  });

  it("hijos antes que padres: ninguna tabla se vacía antes de las que la referencian por FK", () => {
    const order = new Map<string, number>();
    USER_TABLES.forEach((e, i) => {
      if (!order.has(e.table)) order.set(e.table, i);
    });
    for (const t of schemaTables) {
      for (const fk of t.foreignKeys) {
        const parent = getTableConfig(fk.reference().foreignTable).name;
        const child = t.name;
        const onDelete = fk.onDelete;
        // Con cascade o set null el motor se ocupa; sin acción, el hijo tiene que ir primero
        if (onDelete === "cascade" || onDelete === "set null") continue;
        const pi = order.get(parent);
        const ci = order.get(child);
        if (pi === undefined || ci === undefined) continue;
        expect(ci, `${child} referencia a ${parent}`).toBeLessThan(pi);
      }
    }
  });
});
