import { isWebmailDomain } from "@job-search-os/pipeline";
import Link from "next/link";
import { webmailErrorFromParams } from "@/lib/filter-leak";
import { formatDate } from "@/lib/labels";
import { requireUserId } from "@/lib/session";
import { listSenders } from "@/lib/senders";
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
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <Link href="/settings" className="text-xs text-fg-subtle underline">
        ← Ajustes
      </Link>
      <h1 className="text-2xl font-semibold">Remitentes</h1>
      <p className="text-sm text-fg-muted">
        Elegí qué dominios son fuentes de empleo. «Sin decidir» borra tu decisión y el aviso de fuga
        del filtro puede volver a saltar.
      </p>
      {webmailError ? (
        <p
          role="alert"
          data-testid="error-webmail"
          className="rounded-control border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {webmailError}
        </p>
      ) : null}
      <p
        id="aviso-empleo"
        className="rounded-control bg-warning-soft px-3 py-2 text-xs text-warning"
        data-testid="aviso-empleo"
      >
        Los emails de los dominios marcados como empleo se guardan completos.
      </p>

      {senders.length === 0 ? (
        <p className="rounded-control border border-dashed border-line-strong p-6 text-center text-sm text-fg-subtle">
          Todavía no llegó ningún email ni decidiste ningún dominio.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {senders.map((r) => {
            const webmail = isWebmailDomain(r.domain);
            return (
              <li
                key={r.domain}
                className="flex flex-col gap-2 rounded-card border border-line bg-surface p-3 text-sm"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium break-all">{r.domain}</span>
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
                          className={`h-8 w-36 rounded-badge border px-2 text-xs ${
                            current
                              ? "border-brand bg-brand text-brand-contrast"
                              : "border-line-strong bg-surface text-fg-muted"
                          }`}
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
