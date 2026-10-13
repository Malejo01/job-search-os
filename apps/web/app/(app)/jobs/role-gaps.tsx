import { roleGapMessage } from "@job-search-os/pipeline";
import Link from "next/link";
import { getRoleGaps } from "@/lib/role-gaps";

/**
 * «Puestos sin ofertas» (ronda 46): una línea por puesto elegido que no tiene ninguna oferta, con
 * el motivo que sale del prefiltro. Server Component, sin modelo. Si el motivo principal es el
 * filtro de títulos, lleva al link de criterios. No muestra nada si no hay puestos vacíos.
 */
export async function RoleGaps({ userId, title = true }: { userId: string; title?: boolean }) {
  const gaps = await getRoleGaps(userId);
  if (gaps.length === 0) return null;
  return (
    <div
      role="note"
      data-testid="role-gaps"
      className="flex flex-col gap-1 rounded-md bg-zinc-50 px-3 py-2 text-sm text-zinc-700"
    >
      {title ? <p className="font-medium text-zinc-900">Puestos sin ofertas</p> : null}
      <ul className="flex flex-col gap-1">
        {gaps.map((gap) => (
          <li key={gap.role}>
            {roleGapMessage(gap)}
            {gap.mainCause === "blocklist" ? (
              <>
                {" "}
                <Link href="/settings/criteria" className="font-medium underline">
                  Revisá tus criterios
                </Link>
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
