import { schema as s } from "@job-search-os/db";
import { desc } from "drizzle-orm";
import Link from "next/link";
import { withUser } from "@/lib/db";
import { formatDate } from "@/lib/labels";
import { requireUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Emails entrantes (JS-020): lo que llegó a ingest.<dominio>, qué parser lo tomó y qué pasó.
 * Lo que quedó en cola manual (sin parser o estructura no reconocida) se carga a mano en /jobs/new.
 */
export default async function InboxPage() {
  const userId = await requireUserId();
  const rows = await withUser(userId, (tx) =>
    tx
      .select({
        id: s.inboundEmails.id,
        from: s.inboundEmails.fromAddress,
        subject: s.inboundEmails.subject,
        parser: s.inboundEmails.parser,
        jobs: s.inboundEmails.jobsExtracted,
        error: s.inboundEmails.error,
        receivedAt: s.inboundEmails.receivedAt,
      })
      .from(s.inboundEmails)
      .orderBy(desc(s.inboundEmails.receivedAt))
      .limit(50),
  );
  const manual = rows.filter((r) => r.error).length;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Emails entrantes</h1>
        <p className="text-xs text-zinc-500">
          {rows.length} recibidos · {manual} en cola manual
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500">
          Todavía no llegó ningún email. Reenviá las alertas a tu dirección de ingesta (perfil ›
          inbound_address).
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.id} className="rounded-lg border border-zinc-200 bg-white p-3 text-sm">
              <p className="truncate font-medium text-zinc-900">{r.subject ?? "(sin asunto)"}</p>
              <p className="truncate text-xs text-zinc-600">
                {r.from} · {formatDate(r.receivedAt.toISOString())} · parser {r.parser ?? "none"} ·{" "}
                {r.jobs ?? 0} avisos
              </p>
              <p className="mt-1 text-xs">
                <Link href={`/inbox/${r.id}`} className="text-blue-700 underline">
                  Ver contenido
                </Link>
              </p>
              {r.error ? (
                <p className="mt-1 text-xs text-amber-900">
                  {r.error}{" "}
                  <Link href="/jobs/new" className="underline">
                    cargar a mano
                  </Link>
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
