import { CAREER_MATURITY_LABEL, type AgendaRow } from "@job-search-os/pipeline";
import Link from "next/link";
import { getCareerMaturity } from "@/lib/career-maturity";
import {
  getDataState,
  getMarket,
  getRoleMarketView,
  parseRange,
  pickRole,
  type MarketView,
} from "@/lib/market";
import { careerLabel, getCareerMarket, parseCareer } from "@/lib/career-market";
import { getTargetRoles } from "@/lib/onboarding";
import { requireUserId } from "@/lib/session";
import { CareerMarket } from "./career-market";
import { CareerPicker } from "./career-picker";
import { MissingDataNotice, NoLevelsNotice } from "./data-state-notice";
import { RoleMarket } from "./role-market";
import { RoleTabs } from "./role-tabs";
import { SkillCandidates } from "./skill-candidates";
import { SkillRows } from "./skill-rows";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mercado" };

const INPUT_CLASS =
  "w-full rounded-md border border-zinc-300 px-2 py-2 text-sm text-zinc-800 sm:w-auto";

/**
 * Mercado (ronda 58): arriba, "Mercado de <carrera>" con las ofertas públicas del pool (la carrera de
 * la pestaña o la que se explore con `?carrera=`, sin tocar `?rol=`); abajo, "Tu agenda": agenda de
 * mercado (adelanto de JS-031, sin LLM) con lo que piden las ofertas que ya pasaron por el sistema,
 * ponderado por score (Σ score × must ? 1 : 0.4), cruzado con el nivel propio.
 * Server Component; la interactividad son formularios GET (carrera y rango de semanas).
 */
export default async function MarketPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const userId = await requireUserId();
  const params = await searchParams;
  const range = parseRange(params);
  const roles = await getTargetRoles(userId);
  const role = pickRole(roles, params.rol);
  const carrera = parseCareer(params.carrera);
  const careerRole = carrera ?? role;
  const [view, state, roleMarket, careerMarket, maturity] = await Promise.all([
    getMarket(userId, range),
    getDataState(userId),
    getRoleMarketView(userId, role),
    careerRole ? getCareerMarket(careerRole) : null,
    careerRole ? getCareerMaturity(careerRole) : null,
  ]);
  const { agenda } = view;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Mercado</h1>
        <p className="text-xs text-zinc-600">
          {view.weekStart ? `datos de la semana del ${view.weekStart}` : "sin datos todavía"} ·{" "}
          {view.levelsKnown} skills con nivel propio
        </p>
      </div>

      <RoleTabs
        basePath="/market"
        roles={roles}
        active={role}
        keep={{ desde: range.from, hasta: range.to }}
      />
      <CareerPicker current={careerRole} tab={role} />
      {/* C-13: con el flag apagado, sin la función en la base o si falla, no se muestra nada */}
      {careerRole && maturity ? (
        <p
          data-testid="carrera-madurez"
          className={`w-fit rounded-full px-3 py-1 text-xs font-medium ${
            maturity === "madura"
              ? "bg-emerald-100 text-emerald-900"
              : "bg-amber-100 text-amber-900"
          }`}
        >
          {CAREER_MATURITY_LABEL[maturity]}
        </p>
      ) : null}
      {careerRole && careerMarket ? (
        <CareerMarket
          market={careerMarket}
          label={careerLabel(careerRole)}
          backHref={carrera && role && carrera !== role ? `/market?rol=${role}` : undefined}
        />
      ) : (
        <p className="text-xs text-zinc-600">
          Elegí una carrera y ves qué piden las ofertas públicas de los últimos 30 días.
        </p>
      )}

      <h2 className="text-lg font-semibold">Tu agenda</h2>
      <p className="-mt-3 text-xs text-zinc-600">
        Lo que piden las ofertas que ya pasaron por tu cuenta, cruzado con tus niveles.
      </p>
      <Link
        href={role ? `/encaje?rol=${role}` : "/encaje"}
        className="-mt-2 inline-flex min-h-11 w-fit items-center text-sm font-medium text-sky-800 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900"
      >
        Explicado en llano: Tu encaje
      </Link>
      <RoleMarket view={roleMarket} />

      <form method="get" className="flex flex-col gap-2 text-xs text-zinc-600">
        {role ? <input type="hidden" name="rol" value={role} /> : null}
        <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-end">
          <label className="flex flex-col gap-1">
            Desde (semana)
            <input
              type="date"
              name="desde"
              defaultValue={range.from ?? ""}
              className={INPUT_CLASS}
            />
          </label>
          <label className="flex flex-col gap-1">
            Hasta
            <input type="date" name="hasta" defaultValue={range.to ?? ""} className={INPUT_CLASS} />
          </label>
          <button
            type="submit"
            className="min-h-11 w-full rounded-md border border-zinc-400 px-4 py-2 text-sm text-zinc-800 sm:w-auto"
          >
            Aplicar
          </button>
        </div>
        {view.weeks.length ? <p>semanas disponibles: {view.weeks.join(", ")}</p> : null}
      </form>

      <NoLevelsNotice state={state} />

      {!view.weekStart ? (
        !state.hasSnapshot ? (
          <MissingDataNotice state={state} />
        ) : (
          <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-600">
            No hay datos de mercado en ese rango de semanas. Probá con otro rango.
          </p>
        )
      ) : (
        <>
          <Section
            title="Lo que te falta · demanda alta y nivel ≤ básico"
            hint="Lo que más piden las ofertas que te interesan y hoy no tenés. Orden: demanda ponderada."
            rows={agenda.gaps}
            view={view}
            tone="border-red-200"
            testId="market-gaps"
          />
          <Section
            title="Diferenciales · nivel fuerte con demanda"
            hint="Lo que ya tenés y el mercado pide: para destacar en la postulación."
            rows={agenda.differentials}
            view={view}
            tone="border-emerald-200"
            testId="market-differentials"
          />
          <Section
            title="En crecimiento · nivel productivo"
            hint="Productivo pero no fuerte; candidatos a subir con evidencia."
            rows={agenda.growing}
            view={view}
            tone="border-amber-200"
            testId="market-growing"
          />
          <details className="rounded-md border border-zinc-200 p-3 text-sm">
            <summary className="flex min-h-11 cursor-pointer items-center font-semibold">
              Tabla completa ({agenda.all.length} skills)
            </summary>
            <SkillRows rows={agenda.all} view={view} compact />
          </details>
          <SkillCandidates candidates={view.candidates} />
          <details className="rounded-md border border-zinc-200 p-3 text-sm">
            <summary className="flex min-h-11 cursor-pointer items-center font-semibold">
              ¿Cómo se calcula?
            </summary>
            <p className="mt-2 text-xs text-zinc-600">
              La demanda de cada skill suma el puntaje de las ofertas que la piden: cuenta entero si
              es un requisito y 0,4 si es deseable. Las ofertas sin puntaje pesan 5. Las skills se
              reconocen por nombre en cada aviso, sin inteligencia artificial; lo que no está en la
              lista de skills conocidas no cuenta. Tus niveles son los que cargaste en Mis skills.
              Se actualiza cuando guardás tus skills y cada lunes.
            </p>
          </details>
        </>
      )}
    </section>
  );
}

function Section({
  title,
  hint,
  rows,
  view,
  tone,
  testId,
}: {
  title: string;
  hint: string;
  rows: AgendaRow[];
  view: MarketView;
  tone: string;
  testId: string;
}) {
  return (
    <section data-testid={testId} className={`rounded-md border p-3 ${tone}`}>
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="text-xs text-zinc-600">{hint}</p>
      {rows.length ? (
        <SkillRows rows={rows} view={view} />
      ) : (
        <p className="mt-2 text-xs text-zinc-600">— nada en esta categoría —</p>
      )}
    </section>
  );
}
