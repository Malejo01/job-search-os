import { describe, expect, it } from "vitest";
import { signSvix, verifySvix } from "./svix";

const secret = "whsec_" + Buffer.from("clave-de-prueba-de-32-bytes-exactos!").toString("base64");
const body = '{"type":"email.received","data":{"email_id":"abc"}}';
const now = () => 1_789_000_000_000;
const ts = String(Math.floor(now() / 1000));

describe("verifySvix: formato del secreto", () => {
  const prefix = "whsec_";
  const withBytes = (n: number) => prefix + Buffer.alloc(n, 7).toString("base64");

  it.each([
    ["solo el prefijo", prefix],
    ["un espacio", " "],
    ["un salto de línea", "\n"],
    ["base64 inválido", `${prefix}!!!`],
    ["solo relleno", `${prefix}==`],
    ["base64 con caracteres de más", `${withBytes(32)}!`],
    ["menos de 16 bytes", withBytes(15)],
    ["sin el prefijo", Buffer.alloc(32, 7).toString("base64")],
  ])("rechaza %s aunque la firma coincida con esa clave", (_, badSecret) => {
    const signature = signSvix(badSecret, "msg_1", ts, body);
    const headers = {
      "svix-id": "msg_1",
      "svix-timestamp": ts,
      "svix-signature": `v1,${signature}`,
    };

    expect(verifySvix(headers, body, badSecret, now)).toEqual({
      ok: false,
      reason: "secreto inválido",
    });
  });

  it.each([
    ["16 bytes", withBytes(16)],
    ["24 bytes sin relleno", withBytes(24)],
    ["un salto de línea al final", `${withBytes(32)}\n`],
  ])("acepta un secreto de %s", (_, goodSecret) => {
    const signature = signSvix(goodSecret, "msg_1", ts, body);
    const headers = {
      "svix-id": "msg_1",
      "svix-timestamp": ts,
      "svix-signature": `v1,${signature}`,
    };

    expect(verifySvix(headers, body, goodSecret, now)).toEqual({ ok: true });
  });
});

describe("verifySvix", () => {
  it("acepta una firma v1 válida (también entre varias) y rechaza la incorrecta", () => {
    const good = signSvix(secret, "msg_1", ts, body);
    const headers = { "svix-id": "msg_1", "svix-timestamp": ts, "svix-signature": `v1,${good}` };
    expect(verifySvix(headers, body, secret, now)).toEqual({ ok: true });
    expect(
      verifySvix({ ...headers, "svix-signature": `v1,AAAA v1,${good}` }, body, secret, now),
    ).toEqual({ ok: true });
    expect(verifySvix(headers, body + " ", secret, now).ok).toBe(false); // el cuerpo crudo importa
    // Otro secreto (calculado, no literal: un literal con prefijo whsec_ dispara escáneres)
    const otherSecret = "whsec_" + Buffer.from("otro-secreto").toString("base64");
    expect(verifySvix(headers, body, otherSecret, now).ok).toBe(false);
  });

  it("rechaza sin secreto, sin headers o fuera de la tolerancia de 5 min", () => {
    const good = signSvix(secret, "msg_1", ts, body);
    const headers = { "svix-id": "msg_1", "svix-timestamp": ts, "svix-signature": `v1,${good}` };
    expect(verifySvix(headers, body, undefined, now)).toMatchObject({ ok: false });
    expect(verifySvix({ ...headers, "svix-id": null }, body, secret, now)).toMatchObject({
      ok: false,
      reason: "faltan headers svix",
    });
    expect(verifySvix(headers, body, secret, () => now() + 6 * 60 * 1000)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("tolerancia"),
    });
  });
});
