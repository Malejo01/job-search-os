import { describe, expect, it, vi } from "vitest";
import { sendEmail } from "./resend";

describe("sendEmail", () => {
  it("postea a /emails con el remitente sandbox por default", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true } as Response);
    await sendEmail(
      { to: "mauro@example.com", subject: "Asunto", html: "<p>hola</p>" },
      "key_123",
      fetchImpl,
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer key_123" }),
      }),
    );
    const body = JSON.parse(fetchImpl.mock.calls[0]![1].body as string);
    expect(body).toMatchObject({
      from: "Job Search OS <onboarding@resend.dev>",
      to: ["mauro@example.com"],
      subject: "Asunto",
      html: "<p>hola</p>",
    });
  });

  it("usa el from explícito si se pasa", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true } as Response);
    await sendEmail(
      { to: "a@b.com", subject: "s", html: "h", from: "Custom <custom@example.com>" },
      "key",
      fetchImpl,
    );
    const body = JSON.parse(fetchImpl.mock.calls[0]![1].body as string);
    expect(body.from).toBe("Custom <custom@example.com>");
  });

  it("tira error con el status y el cuerpo si Resend no responde ok", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: () => Promise.resolve("dominio no verificado"),
    } as unknown as Response);
    await expect(
      sendEmail({ to: "a@b.com", subject: "s", html: "h" }, "key", fetchImpl),
    ).rejects.toThrow(/HTTP 422.*dominio no verificado/);
  });
});
