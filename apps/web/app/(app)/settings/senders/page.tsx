import { isWebmailDomain } from "@job-search-os/pipeline";
import Link from "next/link";
import { webmailErrorFromParams } from "@/lib/filter-leak";
import { formatDate } from "@/lib/labels";
import { requireUserId } from "@/lib/session";
import { listSenders } from "@/lib/senders";
import { Alert, cardClasses, filterChipClasses, textLinkClasses } from "@/components/ui";
import { setSenderAction } from "./actions";

export const metadata = { title: "Remitentes" };
export const dynamic = "force-dynamic";

const OPTIONS = [
  { verdict: "empleo", label: "Es de empleo" },
  { verdict: "no_empleo", label: "No es de empleo" },
  { verdict: "sin_decidir", label: "Sin decidir" },
] as const;

/**
 * Ajustes › Remitentes: los dominios de los que te llegaron emails (o que ya decidiste) y qué se
 * hace con cada uno. Server Component; cada botón es un formulario con el dominio y la decisión.
 */
export default async function SendersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sender?: string }>;
}) {
  const userId = await requireUserId();
  const senders = await listSenders(userId);
  const webmailError = webmailErrorFromParams(await searchParams);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <Link href="/settings" className={textLinkClasses({ block: true, className: "text-sm" })}>
        ← Ajustes
      </Link>
      <h1 className="text-title font-bold">Remitentes</h1>
      <p className="text-sm text-fg-muted">
        Elegí qué dominios son fuentes de empleo. «Sin decidir» borra tu decisión y el aviso de fuga
        del filtro puede volver a saltar.
      </p>
      {webmailError ? (
        <Alert tone="danger" role="alert" bordered data-testid="error-webmail">
          {webmailError}
        </Alert>
      ) : null}
      <Alert id="aviso-empleo" tone="warning" role={null} data-testid="aviso-empleo">
        Los emails de los dominios marcados como empleo se guardan completos.
      </Alert>

      {senders.length === 0 ? (
        <p className="rounded-container bg-surface px-6 py-8 text-center text-sm text-fg-muted">
          Todavía no llegó ningún email ni decidiste ningún dominio.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {senders.map((r) => {
            const webmail = isWebmailDomain(r.domain);
            return (
              <li
                key={r.domain}
                className={cardClasses({ padding: "sm", className: "flex flex-col gap-3 text-sm" })}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-bold break-all">{r.domain}</span>
                  <span className="text-xs text-fg-subtle">
                    {r.emails} {r.emails === 1 ? "email" : "emails"}
                    {r.lastAt ? ` · último ${formatDate(r.lastAt.toISOString())}` : ""}
                  </span>
                </div>
                <div
                  role="group"
                  aria-label={`Decisión sobre ${r.domain}`}
                  className="flex flex-wrap gap-2"
                >
                  {webmail ? (
                    <span className="self-center text-xs text-fg-muted">
                      Correo personal: no se puede marcar como fuente
                    </span>
                  ) : null}
                  {OPTIONS.filter((o) => !(webmail && o.verdict === "empleo")).map((o) => {
                    const current = (r.verdict ?? "sin_decidir") === o.verdict;
                    return (
                      <form key={o.verdict} action={setSenderAction}>
                        <input type="hidden" name="domain" value={r.domain} />
                        <input type="hidden" name="verdict" value={o.verdict} />
                        <button
                          type="submit"
                          aria-pressed={current}
                          aria-describedby={o.verdict === "empleo" ? "aviso-empleo" : undefined}
                          // C9-11: filtro de 44 px (antes 32); el elegido en lima con borde índigo
                          className={filterChipClasses({ selected: current })}
                        >
                          {o.label}
                        </button>
                      </form>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
