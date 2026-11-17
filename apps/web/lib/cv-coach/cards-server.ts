import { schema as s } from "@job-search-os/db";
import { foldCvText, validateHistory, type CvCoachCard } from "@job-search-os/pipeline";
import { and, eq, sql } from "drizzle-orm";
import { withUser } from "@/lib/db";

/**
 * Guarda una tarjeta del coach que la persona confirmó (ADR-038 §5: nada entra al CV sin el clic). Todo con
 * `withUser` (RLS) y filtrando por la persona, con el lock del historial (25, el mismo de la carga manual y
 * de los huecos del agente) y la misma validación que la carga manual (`validateHistory`). La tarjeta llega
 * del navegador: la ruta ya la revalidó con su esquema y con `screenCoachCard`.
 *
 * Las tarjetas sin ítem (`new_item`, `note`, un `stack` sin ubicar) no se guardan desde acá: la pantalla
 * manda a Historial para cargarlas a mano. El `link` de proyecto espera la columna de R12-4.
 */
export type SaveCoachCardResult =
  { ok: true } | { ok: false; reason: "not_found" | "invalid" | "unsupported" };

const HISTORY_LOCK = 25;
const fold = (t: string) => foldCvText(t).replace(/\s+/g, " ").trim();

export async function saveCoachCard(
  userId: string,
  card: CvCoachCard,
): Promise<SaveCoachCardResult> {
  if (card.kind === "new_item" || card.kind === "note" || card.kind === "link") {
    return { ok: false, reason: "unsupported" };
  }
  const historyId = card.historyId;
  if (historyId === null) return { ok: false, reason: "unsupported" };
  return withUser(userId, async (tx): Promise<SaveCoachCardResult> => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${userId}, ${HISTORY_LOCK}))`,
    );
    const [row] = await tx
      .select()
      .from(s.careerHistory)
      .where(and(eq(s.careerHistory.id, historyId), eq(s.careerHistory.userId, userId)))
      .limit(1);
    if (!row) return { ok: false, reason: "not_found" };
    const next = {
      kind: row.kind,
      organization: row.organization,
      title: row.title,
      startMonth: row.startMonth,
      endMonth: row.endMonth,
      bullets: [...row.bullets],
    };
    const addBullets = (more: readonly string[]) => {
      const seen = new Set(next.bullets.map(fold));
      for (const b of more) {
        if (seen.has(fold(b))) continue;
        next.bullets.push(b);
        seen.add(fold(b));
      }
    };
    if (card.kind === "bullets") addBullets(card.bullets);
    else if (card.kind === "stack") addBullets([`Stack: ${card.stack.join(", ")}`]);
    else if (card.kind === "dates") {
      next.startMonth = card.startMonth;
      next.endMonth = card.isCurrent ? null : card.endMonth;
    } else if (card.kind === "names") {
      next.title = card.title ?? next.title;
      next.organization = card.organization ?? next.organization;
    }
    const form = new Map<string, unknown>([
      ["kind", next.kind],
      ["organization", next.organization],
      ["title", next.title],
      ["startMonth", next.startMonth ?? ""],
      ["endMonth", next.endMonth ?? ""],
      ["bullets", next.bullets.join("\n")],
    ]);
    const checked = validateHistory(form);
    if (!checked.ok) return { ok: false, reason: "invalid" };
    await tx
      .update(s.careerHistory)
      .set({
        organization: checked.value.organization,
        title: checked.value.title,
        startMonth: checked.value.startMonth,
        endMonth: checked.value.endMonth,
        bullets: checked.value.bullets,
        updatedAt: new Date(),
      })
      .where(and(eq(s.careerHistory.id, row.id), eq(s.careerHistory.userId, userId)));
    return { ok: true };
  });
}
