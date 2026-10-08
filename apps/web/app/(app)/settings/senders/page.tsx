import Link from "next/link";
import { formatDate } from "@/lib/labels";
import { requireUserId } from "@/lib/session";
import { listSenders } from "@/lib/senders";
import { setSenderAction } from "./actions";

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
export default async function SendersPage() {
  const userId = await requireUserId();
  const senders = await listSenders(userId);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <Link href="/settings" className="text-xs text-zinc-600 underline">
        ← Ajustes
      </Link>
      <h1 className="text-2xl font-semibold">Remitentes</h1>
      <p className="text-sm text-zinc-700">
        Elegí qué dominios son fuentes de empleo. «Sin decidir» borra tu decisión y el aviso de fuga
        del filtro puede volver a saltar.
      </p>
      <p
        id="aviso-empleo"
        className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900"
        data-testid="aviso-empleo"
      >
        Los emails de los dominios marcados como empleo se guardan completos.
      </p>

      {senders.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500">
          Todavía no llegó ningún email ni decidiste ningún dominio.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {senders.map((r) => (
            <li
              key={r.domain}
              className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3 text-sm"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium break-all">{r.domain}</span>
                <span className="text-xs text-zinc-600">
                  {r.emails} {r.emails === 1 ? "email" : "emails"}
                  {r.lastAt ? ` · último ${formatDate(r.lastAt.toISOString())}` : ""}
                </span>
              </div>
              <div
                role="group"
                aria-label={`Decisión sobre ${r.domain}`}
                className="flex flex-wrap gap-2"
              >
                {OPTIONS.map((o) => {
                  const current = (r.verdict ?? "sin_decidir") === o.verdict;
                  return (
                    <form key={o.verdict} action={setSenderAction}>
                      <input type="hidden" name="domain" value={r.domain} />
                      <input type="hidden" name="verdict" value={o.verdict} />
                      <button
                        type="submit"
                        aria-pressed={current}
                        aria-describedby={o.verdict === "empleo" ? "aviso-empleo" : undefined}
                        className={`h-8 w-36 rounded border px-2 text-xs ${
                          current
                            ? "border-zinc-900 bg-zinc-900 text-white"
                            : "border-zinc-300 bg-white text-zinc-700"
                        }`}
                      >
                        {o.label}
                      </button>
                    </form>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
