import { describe, expect, it } from "vitest";
import {
  classifyInbound,
  GMAIL_CONFIRM_HOSTS,
  GMAIL_FORWARDING_SENDER,
  gmailConfirmLink,
  gmailForwardRequester,
  htmlToText,
  maskDigits,
} from "./inbound-classify";

const mail = (over: Partial<Parameters<typeof classifyInbound>[0]>) => ({
  from: "Alguien <aviso@example.com>",
  to: ["u_aaaaaaaa@ingest.example.com"],
  subject: "Hola",
  text: null,
  ...over,
});

const LINKEDIN = "LinkedIn <jobs-noreply@linkedin.com>";
// Ids inventados, fuera de las URLs literales
const JOB_ID = "45678901";
const SHORT_ID = "1234567";
const GMAIL = `Equipo de Gmail <${GMAIL_FORWARDING_SENDER}>`;
const [OK_HOST] = [...GMAIL_CONFIRM_HOSTS] as [string];

describe("classifyInbound · seguridad", () => {
  it.each([
    "Tu código de verificación es 123456",
    "Your verification code is 482913",
    "Your security code: 998877",
    "Código de seguridad para iniciar sesión",
    "Restablecé tu contraseña",
    "Restablece tu contraseña de Servicio A",
    "Reset your password",
    "Password reset requested",
    "Nuevo inicio de sesión en tu cuenta",
    "New sign-in to your account",
    "Verify your email address",
    "Confirm your email",
    "Confirma tu cuenta de Servicio A",
    "Tu código de un solo uso",
    "Your one-time password",
    "Activá la verificación en dos pasos (2FA)",
    "Two-factor authentication code",
  ])("%s → seguridad, de cualquier remitente", (subject) => {
    expect(classifyInbound(mail({ subject })).category).toBe("seguridad");
    expect(classifyInbound(mail({ subject, from: LINKEDIN })).category).toBe("seguridad");
  });

  it("detecta el código en el comienzo del cuerpo aunque el asunto sea neutro", () => {
    const out = classifyInbound(
      mail({ subject: "Tu acceso", text: "Hola. Tu código de verificación es 554433." }),
    );
    expect(out.category).toBe("seguridad");
  });

  it.each([
    "Analista de Verificación de Datos en Empresa A",
    "Security Engineer en Empresa A",
    "Senior Security Engineer: 3 nuevas ofertas",
    "Data Verification Analyst - Empresa A y 4 más",
    "Código limpio: charla de Empresa A",
    "Security Code Reviewer: 2 nuevas ofertas",
    "Senior Engineer – OTP / Payments en Empresa A",
    "MFA Platform Engineer: nueva oferta",
    "Backend Engineer (2FA, SSO) - Empresa A",
  ])("%s → normal (un título de aviso no es una señal fuerte)", (subject) => {
    expect(classifyInbound(mail({ subject, from: LINKEDIN })).category).toBe("normal");
  });

  it("una alerta de LinkedIn con 'Security Engineer' en el asunto y en el cuerpo es normal", () => {
    const out = classifyInbound({
      from: "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>",
      to: ["u_aaaaaaaa@ingest.example.com"],
      subject: "Security Engineer: 3 nuevas ofertas",
      text: "Security Engineer\nEmpresa A · Remoto\nVerificación de identidad y seguridad de datos",
    });
    expect(out).toEqual({ category: "normal", application: null });
  });
});

describe("classifyInbound · enlace mágico y remitentes esperados", () => {
  it.each([
    "Your magic link to sign in",
    "Tu enlace mágico para entrar",
    "Enlace de acceso a tu cuenta",
    "Here is your sign-in link",
    "Use this log in link",
    "Iniciar sesión con este enlace",
  ])("%s → seguridad", (subject) => {
    expect(classifyInbound(mail({ subject })).category).toBe("seguridad");
  });

  it("detecta el enlace mágico en el cuerpo", () => {
    const out = classifyInbound(
      mail({ subject: "Entrá", text: "Hacé clic en este magic link para entrar" }),
    );
    expect(out.category).toBe("seguridad");
  });

  it("de un remitente esperado, seguridad se decide solo por el asunto", () => {
    const text = "Security Engineer en Empresa A\nSecurity code is 123456 (ejemplo en la JD)";
    const input = { from: LINKEDIN, subject: "Security Engineer en Empresa A", text };
    expect(classifyInbound(input).category).toBe("seguridad");
    expect(classifyInbound({ ...input, securityBySubjectOnly: true }).category).toBe("normal");
    // por el asunto sigue valiendo
    expect(
      classifyInbound({
        ...input,
        subject: "Your verification code is 482913",
        securityBySubjectOnly: true,
      }).category,
    ).toBe("seguridad");
  });

  it("un id de LinkedIn de menos de 8 dígitos no se extrae", () => {
    const out = classifyInbound(
      mail({
        from: LINKEDIN,
        subject: "Se ha enviado tu solicitud a Empresa A",
        text: `https://www.linkedin.com/jobs/view/${SHORT_ID}/`,
      }),
    );
    expect(out.application?.linkedinJobId).toBeNull();
  });
});

describe("htmlToText y gmailForwardRequester", () => {
  it("pasa el HTML a texto sin scripts ni estilos", () => {
    expect(htmlToText("<style>p{}</style><p>Hola&nbsp;<b>mundo</b></p><p>Chau &amp; fin</p>")).toBe(
      "Hola mundo\nChau & fin",
    );
    expect(htmlToText(null)).toBe("");
  });

  it("devuelve la cuenta que pidió el reenvío, en inglés y en español, o null", () => {
    expect(
      gmailForwardRequester(
        "persona.a@example.com has requested to automatically forward mail to your email address",
        null,
      ),
    ).toBe("persona.a@example.com");
    expect(
      gmailForwardRequester(
        null,
        "<p>Persona A (<b>Persona.A@Example.com</b>) ha solicitado reenviar correo</p>",
      ),
    ).toBe("persona.a@example.com");
    expect(gmailForwardRequester("Mensaje sin cuenta nombrada", null)).toBeNull();
    expect(
      gmailForwardRequester("Escribinos a soporte@example.com por consultas", null),
    ).toBeNull();
  });
});

describe("classifyInbound · reenvío de Gmail", () => {
  it("remitente exacto + asunto de confirmación", () => {
    expect(
      classifyInbound(
        mail({
          from: GMAIL,
          subject: "(#123456789019) Gmail Forwarding Confirmation - Receive Mail",
        }),
      ).category,
    ).toBe("confirmacion_reenvio_gmail");
    expect(
      classifyInbound(mail({ from: GMAIL, subject: "Confirmación de reenvío de Gmail" })).category,
    ).toBe("confirmacion_reenvio_gmail");
  });

  it("gana sobre seguridad aunque el cuerpo traiga un código de confirmación", () => {
    const out = classifyInbound(
      mail({
        from: GMAIL,
        subject: "Gmail Forwarding Confirmation",
        text: "Your confirmation code is 123456",
      }),
    );
    expect(out.category).toBe("confirmacion_reenvio_gmail");
  });

  it("otro remitente con el mismo asunto no es la confirmación", () => {
    const out = classifyInbound(
      mail({
        from: `x <${GMAIL_FORWARDING_SENDER}.evil.example>`,
        subject: "Gmail Forwarding Confirmation",
      }),
    );
    expect(out.category).not.toBe("confirmacion_reenvio_gmail");
    expect(
      classifyInbound(
        mail({
          from: `x <${GMAIL_FORWARDING_SENDER.replace("forwarding-", "")}>`,
          subject: "Gmail Forwarding Confirmation",
        }),
      ).category,
    ).not.toBe("confirmacion_reenvio_gmail");
  });

  it("el remitente exacto con otro asunto es normal", () => {
    expect(classifyInbound(mail({ from: GMAIL, subject: "Alerta de seguridad" })).category).toBe(
      "normal",
    );
  });
});

describe("classifyInbound · postulaciones de LinkedIn", () => {
  it("enviada, en español", () => {
    const out = classifyInbound(
      mail({ from: LINKEDIN, subject: "Se ha enviado tu solicitud a Empresa A" }),
    );
    expect(out.category).toBe("postulacion_enviada");
    expect(out.application).toEqual({
      company: "Empresa A",
      title: null,
      linkedinJobId: null,
      linkedinUrl: null,
    });
  });

  it("enviada, en inglés", () => {
    const out = classifyInbound(
      mail({ from: LINKEDIN, subject: "Your application was sent to Empresa B" }),
    );
    expect(out.category).toBe("postulacion_enviada");
    expect(out.application?.company).toBe("Empresa B");
  });

  it("vista, en español e inglés", () => {
    const es = classifyInbound(
      mail({ from: LINKEDIN, subject: "Empresa A ha visto tu solicitud" }),
    );
    expect(es.category).toBe("postulacion_vista");
    expect(es.application?.company).toBe("Empresa A");
    const en = classifyInbound(
      mail({ from: LINKEDIN, subject: "Your application was viewed by Empresa C" }),
    );
    expect(en.category).toBe("postulacion_vista");
    expect(en.application?.company).toBe("Empresa C");
  });

  it("extrae el id y la URL del aviso y el puesto cuando vienen en el cuerpo", () => {
    const out = classifyInbound(
      mail({
        from: LINKEDIN,
        subject: "Se ha enviado tu solicitud a Empresa A",
        text: `Se ha enviado tu solicitud a Empresa A\nIngeniero de Pruebas\nEmpresa A · Remoto\nVer el aviso: https://www.linkedin.com/comm/jobs/view/${JOB_ID}/?trackingId=zzz`,
      }),
    );
    expect(out.application).toMatchObject({
      company: "Empresa A",
      title: "Ingeniero de Pruebas",
      linkedinJobId: JOB_ID,
      linkedinUrl: `https://www.linkedin.com/jobs/view/${JOB_ID}/`,
    });
  });

  it("no inventa nada: sin empresa legible queda null", () => {
    const out = classifyInbound(mail({ from: LINKEDIN, subject: "Se ha enviado tu solicitud" }));
    expect(out.category).toBe("postulacion_enviada");
    expect(out.application).toEqual({
      company: null,
      title: null,
      linkedinJobId: null,
      linkedinUrl: null,
    });
  });

  it("el mismo asunto de un remitente que no es LinkedIn es normal", () => {
    expect(
      classifyInbound(mail({ subject: "Se ha enviado tu solicitud a Empresa A" })).category,
    ).toBe("normal");
    expect(
      classifyInbound(
        mail({
          from: "x <a@linkedin.com.evil.example>",
          subject: "Empresa A ha visto tu solicitud",
        }),
      ).category,
    ).toBe("normal");
  });
});

describe("maskDigits", () => {
  it("enmascara secuencias de 4 o más dígitos y códigos alfanuméricos", () => {
    expect(maskDigits("Tu código es 482913")).toBe("Tu código es •••");
    expect(maskDigits("Código: 123-456")).toBe("Código: •••");
    expect(maskDigits("Use A1B2C3D4 to sign in")).toBe("Use ••• to sign in");
    expect(maskDigits("Pin 123 y 4567")).toBe("Pin 123 y •••");
  });

  it("deja el texto normal", () => {
    expect(maskDigits("Restablecé tu contraseña")).toBe("Restablecé tu contraseña");
    expect(maskDigits("Empresa A")).toBe("Empresa A");
  });
});

describe("gmailConfirmLink", () => {
  const ok = "https://mail.google.com/mail/vf-%5BAAA%5D-bbb";
  it("devuelve el primer link https de mail.google.com o mail-settings.google.com", () => {
    expect(gmailConfirmLink(`Hacé clic: ${ok} gracias`, null)).toBe(ok);
    expect(gmailConfirmLink(null, `<a href="${ok}&amp;x=1">confirmar</a>`)).toBe(`${ok}&x=1`);
    expect(gmailConfirmLink("https://mail-settings.google.com/mail/u/0/#settings", null)).toBe(
      "https://mail-settings.google.com/mail/u/0/#settings",
    );
  });

  it("descarta hosts parecidos, http y @ en la autoridad", () => {
    expect(gmailConfirmLink("https://mail.google.com.evil.example/x", null)).toBeNull();
    expect(gmailConfirmLink("https://evil.example/?u=mail.google.com", null)).toBeNull();
    expect(gmailConfirmLink("http://mail.google.com/mail/vf-1", null)).toBeNull();
    expect(gmailConfirmLink("https://mail.google.com@evil.example/x", null)).toBeNull();
    expect(gmailConfirmLink(`https://evil.example@${OK_HOST}/x`, null)).toBeNull();
    expect(gmailConfirmLink("https://notmail.google.com/x", null)).toBeNull();
    expect(gmailConfirmLink("https://mail.google.com:8443/x", null)).toBeNull();
  });

  it("sigue buscando después de un link trampa", () => {
    expect(gmailConfirmLink(`http://mail.google.com/a ${ok}`, null)).toBe(ok);
  });

  it("sin links devuelve null", () => {
    expect(gmailConfirmLink("nada", null)).toBeNull();
    expect(gmailConfirmLink(null, null)).toBeNull();
  });
});
