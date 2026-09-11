import { describe, expect, it } from "vitest";
import { signSvix, verifySvix } from "./svix";

const secret = "whsec_" + Buffer.from("clave-de-prueba-de-32-bytes-exactos!").toString("base64");
const body = '{"type":"email.received","data":{"email_id":"abc"}}';
const now = () => 1_789_000_000_000;
const ts = String(Math.floor(now() / 1000));

describe("verifySvix", () => {
  it("acepta una firma v1 válida (también entre varias) y rechaza la incorrecta", () => {
    const good = signSvix(secret, "msg_1", ts, body);
    const headers = { "svix-id": "msg_1", "svix-timestamp": ts, "svix-signature": `v1,${good}` };
    expect(verifySvix(headers, body, secret, now)).toEqual({ ok: true });
    expect(
      verifySvix({ ...headers, "svix-signature": `v1,AAAA v1,${good}` }, body, secret, now),
    ).toEqual({ ok: true });
    expect(verifySvix(headers, body + " ", secret, now).ok).toBe(false); // el cuerpo crudo importa
    expect(verifySvix(headers, body, "whsec_b3Ryby1zZWNyZXRv", now).ok).toBe(false);
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
