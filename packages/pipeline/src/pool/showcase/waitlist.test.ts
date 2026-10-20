import { describe, expect, it } from "vitest";
import { isHoneypotFilled, parseWaitlistForm, waitlistInputSchema } from "./waitlist";

const valid = {
  name: "Persona Uno",
  email: "persona@example.com",
  role: "frontend",
  heardFrom: "",
};

describe("parseWaitlistForm", () => {
  it("acepta un pedido válido y deja heardFrom en null si viene vacío", () => {
    const r = parseWaitlistForm(valid);
    expect(r).toEqual({
      ok: true,
      value: {
        name: "Persona Uno",
        email: "persona@example.com",
        role: "frontend",
        heardFrom: null,
      },
    });
  });

  it("normaliza: recorta el nombre y pasa el email a minúsculas sin espacios", () => {
    const r = parseWaitlistForm({
      ...valid,
      name: "  Persona Uno ",
      email: "  Persona@Example.COM ",
      heardFrom: " un amigo ",
    });
    expect(r.ok && r.value).toEqual({
      name: "Persona Uno",
      email: "persona@example.com",
      role: "frontend",
      heardFrom: "un amigo",
    });
  });

  it("no devuelve el honeypot entre los datos", () => {
    const r = parseWaitlistForm({ ...valid, website: "" });
    expect(r.ok && Object.keys(r.value)).not.toContain("website");
  });

  it("devuelve un mensaje corto por campo inválido, sin ecos del valor", () => {
    const r = parseWaitlistForm({
      name: "   ",
      email: "no-es-un-email",
      role: "astronauta",
      heardFrom: "",
    });
    expect(r).toEqual({
      ok: false,
      error: {
        name: "Escribí tu nombre",
        email: "Ese email no parece válido",
        role: "Elegí una carrera",
      },
    });
  });

  it("tolera campos ausentes o que no son texto", () => {
    const r = parseWaitlistForm({ name: 5, role: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.error).sort()).toEqual(["email", "name", "role"]);
  });

  it("acepta todas las carreras de ROLE_KEYS y rechaza una que no está", () => {
    expect(parseWaitlistForm({ ...valid, role: "ciberseguridad" }).ok).toBe(true);
    expect(parseWaitlistForm({ ...valid, role: "" }).ok).toBe(false);
  });

  it("respeta los largos límite: nombre 120, email 254, cómo te enteraste 200", () => {
    expect(parseWaitlistForm({ ...valid, name: "n".repeat(120) }).ok).toBe(true);
    const longName = parseWaitlistForm({ ...valid, name: "n".repeat(121) });
    expect(!longName.ok && longName.error.name).toBe("Es demasiado largo (máximo 120 caracteres)");

    const local = "a".repeat(64);
    const domain = `${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(57)}.com`;
    const email254 = `${local}@${domain}`;
    expect(email254).toHaveLength(254);
    expect(parseWaitlistForm({ ...valid, email: email254 }).ok).toBe(true);
    expect(parseWaitlistForm({ ...valid, email: `x${email254}` }).ok).toBe(false);

    expect(parseWaitlistForm({ ...valid, heardFrom: "h".repeat(200) }).ok).toBe(true);
    const longHeard = parseWaitlistForm({ ...valid, heardFrom: "h".repeat(201) });
    expect(!longHeard.ok && longHeard.error.heardFrom).toBeDefined();
  });
});

describe("isHoneypotFilled", () => {
  it("es true solo si el campo trampa trae texto", () => {
    expect(isHoneypotFilled({ website: "https://spam.example" })).toBe(true);
    expect(isHoneypotFilled({ website: "" })).toBe(false);
    expect(isHoneypotFilled({ website: "   " })).toBe(false);
    expect(isHoneypotFilled({})).toBe(false);
  });

  it("el esquema deja pasar el honeypot para que el servidor decida", () => {
    const r = waitlistInputSchema.safeParse({ ...valid, website: "x" });
    expect(r.success && isHoneypotFilled(r.data)).toBe(true);
  });
});
