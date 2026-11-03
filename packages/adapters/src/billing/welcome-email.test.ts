import { describe, expect, it, vi } from "vitest";
import { sendWelcomeEmail } from "./welcome-email";

const ENV = {
  WELCOME_EMAIL_ENABLED: "1",
  RESEND_API_KEY: "re_test",
  EMAIL_FROM: "AfinIAJobs <hola@ejemplo.test>",
  SITE_URL: "https://ejemplo.test",
  NODE_ENV: "production",
};

function logger() {
  return { info: vi.fn(), warn: vi.fn() };
}

const base = {
  to: "persona@ejemplo.test",
  until: new Date("2026-12-26T15:00:00Z"),
  source: "pago" as const,
};

describe("sendWelcomeEmail (C8-7)", () => {
  it("apagado por defecto: no manda", async () => {
    const send = vi.fn();
    const r = await sendWelcomeEmail({
      ...base,
      env: { ...ENV, WELCOME_EMAIL_ENABLED: "" },
      logger: logger(),
      send,
    });
    expect(r).toBe("apagado");
    expect(send).not.toHaveBeenCalled();
  });

  it("sin Resend o sin remitente propio, no manda", async () => {
    const send = vi.fn();
    expect(
      await sendWelcomeEmail({ ...base, env: { ...ENV, EMAIL_FROM: "" }, logger: logger(), send }),
    ).toBe("sin_resend");
    expect(send).not.toHaveBeenCalled();
  });

  it("manda una vez, con el remitente de siempre, los pasos y la fecha", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const log = logger();
    expect(await sendWelcomeEmail({ ...base, env: ENV, logger: log, send })).toBe("enviado");
    expect(send).toHaveBeenCalledTimes(1);
    const [params, key] = send.mock.calls[0]!;
    expect(key).toBe("re_test");
    expect(params).toMatchObject({ to: "persona@ejemplo.test", from: ENV.EMAIL_FROM });
    expect(params.text).toContain("https://ejemplo.test/settings/perfil");
    expect(params.text).toContain("26 de diciembre");
    // El log nunca lleva el email
    expect(JSON.stringify(log.info.mock.calls)).not.toContain("persona@ejemplo.test");
  });

  it("si Resend falla, no tira y loguea solo el código HTTP", async () => {
    const send = vi
      .fn()
      .mockRejectedValue(new Error("Resend POST /emails: HTTP 429 persona@ejemplo.test"));
    const log = logger();
    expect(await sendWelcomeEmail({ ...base, env: ENV, logger: log, send })).toBe("fallo");
    expect(log.warn).toHaveBeenCalledWith({ status: 429 }, "bienvenida: falló el envío");
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain("persona@ejemplo.test");
  });
});
