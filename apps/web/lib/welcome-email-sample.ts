import { buildWelcomeEmail, cvChatMode } from "@job-search-os/pipeline";
import { siteUrl } from "./site-url";

/** Email de bienvenida (C8-7) con datos de ejemplo, para la vista previa de /settings/marca. */
export function welcomeEmailSample() {
  return buildWelcomeEmail({
    displayName: "Lucía",
    // Fecha fija de ejemplo: la apertura de la beta (26/11) más los 30 días del plan
    until: new Date("2026-12-26T15:00:00Z"),
    becado: false,
    appUrl: siteUrl(),
    contactEmail: null,
    cvEnabled: cvChatMode(process.env) === "all",
  });
}
