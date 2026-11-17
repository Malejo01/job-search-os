import Link from "next/link";
import { profileAgentPath, type ProfileAgentBase } from "@job-search-os/pipeline";
import { buttonClasses, cardClasses } from "@/components/ui";

/**
 * Entrada al agente de perfil: «Subí tu CV y armamos tu perfil» (ADR-034 §9). Server Component sin
 * lógica: quien lo muestra ya comprobó el flag (`profileAgentAllowedFor`). Va en `/cv` (base `app`) y,
 * en R10-5, en la elección del onboarding (base `onboarding`).
 */
export function UploadCard({ base = "app" }: { base?: ProfileAgentBase }) {
  return (
    <section
      aria-labelledby="pa-entrada"
      data-testid="profile-agent-entry"
      className={cardClasses({
        level: "list",
        padding: "md",
        className: "no-print flex flex-col gap-2",
      })}
    >
      <h2 id="pa-entrada" className="text-base font-bold text-fg">
        Subí tu CV y armamos tu perfil
      </h2>
      <p className="text-sm text-fg-muted">
        Leemos tu CV en tu navegador (el archivo no se sube), vos confirmás lo que entendimos y
        completamos solo lo que falte. No se guarda nada hasta que lo confirmes.
      </p>
      <Link
        href={profileAgentPath(base, "read")}
        className={buttonClasses({ className: "self-start" })}
      >
        Subir mi CV
      </Link>
    </section>
  );
}
