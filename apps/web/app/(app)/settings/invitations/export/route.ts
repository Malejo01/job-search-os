import { filterWaitlist, parseWaitlistFilters, waitlistCsv } from "@job-search-os/pipeline";
import { NextResponse } from "next/server";
import { canCreateInvitations } from "@/lib/invitations";
import { activeSessionUserId } from "@/lib/session";
import { ROLE_SKILLS } from "@/lib/skill-levels";
import { listWaitlist, WaitlistNotEnabledInDbError } from "@/lib/waitlist-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "text/csv; charset=utf-8",
} as const;

/**
 * GET /settings/invitations/export: la lista de espera (con los mismos filtros de la pantalla) en CSV,
 * solo nombre, email, carrera, origen y fecha. Solo admin. Datos personales: sin caché y nada va al log.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const userId = await activeSessionUserId();
  if (!userId) return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  if (!(await canCreateInvitations(userId))) {
    return NextResponse.json({ error: "no autorizado" }, { status: 403 });
  }
  let entries;
  try {
    entries = await listWaitlist(userId);
  } catch (error) {
    if (error instanceof WaitlistNotEnabledInDbError) {
      return NextResponse.json({ error: "no autorizado" }, { status: 403 });
    }
    throw error;
  }
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const rows = filterWaitlist(entries, parseWaitlistFilters(params));
  const label = (role: string) =>
    (ROLE_SKILLS as Record<string, { label: string } | undefined>)[role]?.label ?? role;
  return new NextResponse(waitlistCsv(rows, label), {
    headers: {
      ...HEADERS,
      "Content-Disposition": 'attachment; filename="lista-de-espera.csv"',
    },
  });
}
