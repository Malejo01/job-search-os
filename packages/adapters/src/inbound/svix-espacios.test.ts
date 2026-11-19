import { describe, expect, it } from "vitest";
import { signSvix, verifySvix } from "./svix";

/** Un secreto con espacios en los bordes se valida y se firma con el mismo valor. */
const KEY = "dGVzdC1zZWNyZXRvLWRlLXBydWViYS0xMjM0NQ==";
const SECRET = `whsec_${KEY}`;
const NOW = 1_800_000_000_000;
const ID = "msg_1";
const TS = String(NOW / 1000);
const BODY = '{"type":"email.received"}';

const headers = (signature: string) => ({
  "svix-id": ID,
  "svix-timestamp": TS,
  "svix-signature": `v1,${signature}`,
});
const signature = signSvix(SECRET, ID, TS, BODY);

describe("verifySvix con espacios en el secreto", () => {
  it.each([
    ["un espacio adelante", ` ${SECRET}`],
    ["un salto de línea al final", `${SECRET}\n`],
    ["espacios a los dos lados", `  ${SECRET} `],
  ])("%s: la firma correcta se acepta", (_, secret) => {
    expect(verifySvix(headers(signature), BODY, secret, () => NOW)).toEqual({ ok: true });
  });

  it("sin espacios sigue aceptando la firma correcta", () => {
    expect(verifySvix(headers(signature), BODY, SECRET, () => NOW)).toEqual({ ok: true });
  });

  it("una firma incorrecta se rechaza igual", () => {
    expect(verifySvix(headers("AAAA"), BODY, ` ${SECRET}`, () => NOW)).toEqual({
      ok: false,
      reason: "firma no coincide",
    });
  });

  it("signSvix da la misma firma con o sin espacios en los bordes", () => {
    expect(signSvix(` ${SECRET}\n`, ID, TS, BODY)).toBe(signature);
  });
});
