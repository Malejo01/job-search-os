import Link from "next/link";
import { careerLabel } from "@/lib/career-market";
import { pickRole } from "@/lib/market";
import { getMarketMinimal } from "@/lib/market-minimal";
import { getTargetRoles } from "@/lib/onboarding";
import { requireUserId } from "@/lib/session";
import { MERCADO_TEXTOS as T } from "@/lib/textos-rediseno";
import { buttonClasses } from "@/components/ui";
import { MarketMinimalView } from "./market-minimal";
import { RoleTabs } from "./role-tabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mercado" };

/**
 * Mercado mínimo (R34-03): una sola página para la carrera de la persona (las pestañas son sus puestos, sin
 * explorar otras carreras ni filtros que recarguen) y solo con avisos vigentes. Server Component. La agenda
 * de habilidades, el rango de semanas y las carreras ajenas salieron de la pantalla; `/encaje` sigue con lo suyo.
 */
export default async function MarketPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const userId = await requireUserId();
  const params = await searchParams;
  const roles = await getTargetRoles(userId);
  // `?carrera=` lo siguen usando los links de «Hoy»: vale solo si es uno de los puestos de la persona; otra
  // carrera se ignora (el mercado mínimo no explora carreras ajenas).
  const role = pickRole(roles, params.rol ?? params.carrera);
  const market = role ? await getMarketMinimal(userId, role) : null;
  const label = role ? careerLabel(role) : "";

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-title font-bold">
          {role ? T.titulo.replace("{carrera}", label) : "Mercado"}
        </h1>
        {role ? <p className="text-sm text-fg-muted">{T.guia}</p> : null}
      </div>
      <RoleTabs basePath="/market" roles={roles} active={role} />
      {role && market ? (
        <MarketMinimalView market={market} label={label} />
      ) : (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-fg-muted">{T.sinCarrera}</p>
          <Link href="/settings#puesto" className={buttonClasses({ variant: "secondary" })}>
            {T.sinCarreraAccion}
          </Link>
        </div>
      )}
    </section>
  );
}
