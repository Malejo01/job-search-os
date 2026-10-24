import { createLogger } from "@job-search-os/adapters";
import {
  FIT_GROUPS,
  FIT_THRESHOLDS,
  SELF_LEVELS,
  type CareerMarket,
  type FitGroup,
  type FitSkill,
  type FitSkillLevel,
} from "@job-search-os/pipeline";
import Link from "next/link";
import type { ReactNode } from "react";
import { careerLabel } from "@/lib/career-market";
import { getFitData, type FitData } from "@/lib/fit";
import type { ChecklistItemView } from "@/lib/job-detail";
import { pickRole } from "@/lib/market";
import { getTargetRoles } from "@/lib/onboarding";
import { requireUserId } from "@/lib/session";
import { missingCta } from "@/components/requisitos-del-aviso";
import { RoleTabs } from "../market/role-tabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tu encaje" };

const SECTION = "flex min-w-0 flex-col gap-2 rounded-md border border-zinc-200 px-3 py-3";
const H2 = "text-base font-semibold text-zinc-900";
const LIST = "m-0 flex list-none flex-col gap-2 p-0";
const MUTED = "text-sm text-zinc-700";
const LINK =
  "inline-flex min-h-11 w-fit items-center font-medium text-sky-800 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const offersText = (n: number) => plural(n, "oferta", "ofertas");
/** «de cada 10»: se redondea a entero, sin porcentajes propios. */
const perTen = (n: number, total: number) => (total > 0 ? Math.round((10 * n) / total) : 0);

/** Bloque de la página: `<section aria-labelledby>` con su `<h2>`. */
function Block({
  id,
  testId,
  title,
  children,
}: {
  id: string;
  testId: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section data-testid={testId} aria-labelledby={id} className={SECTION}>
      <h2 id={id} className={H2}>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** «Tu encaje» (C-6, E2): qué piden tus ofertas, qué te falta y qué tenés de más. Sin LLM. */
export default async function EncajePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const userId = await requireUserId();
  const params = await searchParams;
  const roles = await getTargetRoles(userId);
  const role = pickRole(roles, params.rol);

  if (!role) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold">Tu encaje</h1>
        <div data-testid="encaje-vacio-sin-carrera" className={`${SECTION} text-sm`}>
          <p className={MUTED}>Para decirte cómo encajás primero necesitamos saber tu carrera.</p>
          <Link href="/settings#puesto" className={LINK}>
            Elegí tu carrera
          </Link>
        </div>
      </div>
    );
  }

  let fit: FitData | null = null;
  try {
    fit = await getFitData(userId, role, new Date());
  } catch (err) {
    // Solo el tipo de error: el mensaje puede traer parámetros de la consulta
    const errName = err instanceof Error ? err.name : "desconocido";
    createLogger({ user_id: userId, task: "tu_encaje" }).error({ errName }, "tu encaje falló");
  }
  if (!fit) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold">Tu encaje</h1>
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-900">
          No pudimos calcular tu encaje. Probá de nuevo en un rato.
        </p>
      </div>
    );
  }

  const label = careerLabel(role);
  const { summary, market } = fit;
  const { basis } = summary;
  const noLevels = fit.levelsCount === 0;
  const ranked = !basis.smallSample;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-xl font-semibold">Tu encaje</h1>
        <p data-testid="encaje-base" className="text-xs text-zinc-600">
          {basis.offers === 0 ? (
            <>
              Todavía no hay ofertas evaluadas en los últimos {fit.windowDays} días.{" "}
              <Link href={`/market?carrera=${role}`} className="underline">
                Mirá el mercado público de {label}
              </Link>{" "}
              o{" "}
              <Link href="/jobs/new" className="underline">
                pegá una oferta
              </Link>
              .
            </>
          ) : (
            `Con ${offersText(basis.offers)} evaluadas en los últimos ${fit.windowDays} días y el mercado público de ${label}.`
          )}
        </p>
      </div>
      <RoleTabs basePath="/encaje" roles={roles} active={role} />

      <Block id="encaje-frase-titulo" testId="encaje-frase" title="En una frase">
        <p className="text-sm text-zinc-900">{summary.headline}</p>
      </Block>

      {fit.withoutChecklist > 0 && basis.offers > 0 ? (
        <p data-testid="encaje-vacio-viejas" className="text-xs text-zinc-600">
          {fit.withoutChecklist === 1
            ? "1 oferta vieja no tiene el detalle de requisitos y no cuenta acá."
            : `${fit.withoutChecklist} ofertas viejas no tienen el detalle de requisitos y no cuentan acá.`}
        </p>
      ) : null}

      {basis.offers > 0 && !ranked ? (
        <div data-testid="encaje-vacio-base-chica" className={`${SECTION} text-sm`}>
          <p className={MUTED}>
            Tenés {plural(basis.withChecklist, "oferta con", "ofertas con")} el detalle de
            requisitos. Con {FIT_THRESHOLDS.minBase} o más armamos lo que más te frena y lo que te
            falta.
          </p>
          <Link href="/jobs/new" className={LINK}>
            Pegá una oferta
          </Link>
        </div>
      ) : null}

      {ranked ? (
        <>
          <Blockers groups={summary.blockers} total={basis.withChecklist} fit={fit} />
          <Unknowns groups={summary.unknowns} total={basis.withChecklist} />
        </>
      ) : null}

      {ranked && noLevels ? (
        <div data-testid="encaje-vacio-sin-niveles" className={`${SECTION} text-sm`}>
          <p className={MUTED}>
            Todavía no cargaste tus skills, así que no podemos decir qué tenés y qué te falta.
          </p>
          <Link href="/settings/skills" className={LINK}>
            Cargá tus skills
          </Link>
        </div>
      ) : null}

      {ranked && !noLevels ? (
        <>
          <SkillBlock
            id="encaje-tenes-titulo"
            testId="encaje-tenes"
            title="Lo que ya tenés y te piden"
            empty="Ninguna skill que ya manejás aparece en 2 o más de tus ofertas."
            rows={summary.strengths}
            total={basis.offers}
          />
          <SkillBlock
            id="encaje-falta-titulo"
            testId="encaje-falta"
            title="Lo que te falta"
            empty="No hay ninguna skill que te falte y aparezca en 2 o más de tus ofertas."
            rows={summary.gaps}
            total={basis.offers}
            footer={
              <Link href="/plan" className={LINK}>
                Armá tu plan
              </Link>
            }
          />
          {summary.unrated.length > 0 ? (
            <Block
              id="encaje-sin-nivel-titulo"
              testId="encaje-sin-nivel"
              title="Te piden y no cargaste tu nivel"
            >
              <p className="text-xs text-zinc-600">
                Si no cargaste tu nivel, no podemos decir si te falta o no.
              </p>
              <ul className={LIST}>
                {summary.unrated.map((skill) => (
                  <li key={skill.slug} className="min-w-0 break-words text-sm">
                    <span className="font-medium text-zinc-900">{skill.name}</span>
                    <span className={MUTED}>
                      : la piden {skill.count} de {basis.offers} ofertas
                    </span>
                  </li>
                ))}
              </ul>
              <Link href="/settings/skills" className={LINK}>
                Cargá tu nivel
              </Link>
            </Block>
          ) : null}
          {summary.surplus.length > 0 ? (
            <details
              data-testid="encaje-sobra"
              className="rounded-md border border-zinc-200 px-3 text-sm"
            >
              <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-zinc-900">
                Lo que tenés y casi no piden
              </summary>
              <p className="pb-1 text-zinc-700">
                Estas skills las manejás y casi no aparecen en tus ofertas ni en el mercado de{" "}
                {label}: {summary.surplus.map((k) => k.name).join(", ")}. No es algo malo: solo no
                es lo que hoy te piden.
              </p>
            </details>
          ) : null}
        </>
      ) : null}

      <MarketBlock market={market} label={label} fit={fit} />

      <details className="rounded-md border border-zinc-200 px-3 text-sm">
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-zinc-900">
          Cómo se calcula
        </summary>
        <p className="pb-2 text-xs text-zinc-700">
          Contamos los requisitos que ya revisamos en cada oferta. Para esta pantalla no usamos
          inteligencia artificial. Miramos tus ofertas evaluadas de los últimos {fit.windowDays}{" "}
          días (hasta 200) y las comparamos con tus niveles y con las ofertas públicas de tu
          carrera. Se actualiza cada 15 minutos. Un requisito entra si aparece en 2 o más ofertas y
          en una de cada 5; con menos de {FIT_THRESHOLDS.minBase} ofertas no armamos listas
          ordenadas.
        </p>
      </details>
    </div>
  );
}

/** Ícono de estado con texto al lado: nunca el estado solo con color. */
function Mark({ children }: { children: string }) {
  return (
    <span aria-hidden="true" className="mr-1">
      {children}
    </span>
  );
}

function Blockers({ groups, total, fit }: { groups: FitGroup[]; total: number; fit: FitData }) {
  return (
    <Block id="encaje-frenos-titulo" testId="encaje-frenos" title="Lo que más te frena">
      {groups.length === 0 ? (
        <p className={MUTED}>Ningún requisito te frena en 2 o más de tus ofertas.</p>
      ) : (
        <ul className={LIST}>
          {groups.map((group) => (
            <li
              key={group.key}
              data-testid={`encaje-freno-${group.key}`}
              className="min-w-0 text-sm"
            >
              <p className="break-words">
                <Mark>⚠</Mark>
                <span className="font-medium text-zinc-900">{group.label}</span>
                <span className={MUTED}>
                  : no se cumple en {group.count} de {total} ofertas
                </span>
                {group.key === "ingles" && fit.profile.englishCefr ? (
                  <span className={MUTED}>. Tu inglés cargado es {fit.profile.englishCefr}</span>
                ) : null}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Block>
  );
}

/** Adónde cargar un dato que falta; reusa `missingCta` del detalle de la oferta. */
function unknownCta(group: FitGroup): { href: string; text: string } | null {
  const ids = FIT_GROUPS.find((g) => g.key === group.key)?.ids ?? [];
  const stub = { id: ids[0] ?? group.key, pide: group.label } as ChecklistItemView;
  return missingCta(stub);
}

function Unknowns({ groups, total }: { groups: FitGroup[]; total: number }) {
  if (groups.length === 0) return null;
  return (
    <Block id="encaje-datos-titulo" testId="encaje-datos" title="Lo que no sabemos de vos">
      <ul className={LIST}>
        {groups.map((group) => {
          const cta = unknownCta(group);
          return (
            <li
              key={group.key}
              data-testid={`encaje-dato-${group.key}`}
              className="min-w-0 text-sm"
            >
              <p className="break-words">
                <Mark>?</Mark>
                <span className="font-medium text-zinc-900">{group.label}</span>
                <span className={MUTED}>
                  : en {group.count} de {total} ofertas no sabemos si lo cumplís
                </span>
              </p>
              {cta ? (
                <Link href={cta.href} className={LINK}>
                  {cta.text}
                </Link>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Block>
  );
}

function SkillBlock({
  id,
  testId,
  title,
  empty,
  rows,
  total,
  footer,
}: {
  id: string;
  testId: string;
  title: string;
  empty: string;
  rows: FitSkillLevel[];
  total: number;
  footer?: ReactNode;
}) {
  return (
    <Block id={id} testId={testId} title={title}>
      {rows.length === 0 ? (
        <p className={MUTED}>{empty}</p>
      ) : (
        <ul className={LIST}>
          {rows.map((skill) => (
            <li key={skill.slug} className="min-w-0 break-words text-sm">
              <span className="font-medium text-zinc-900">{skill.name}</span>
              <span className={MUTED}>
                : la piden {skill.count} de {total} ofertas{mustText(skill)}. Tu nivel:{" "}
                {SELF_LEVELS[skill.level]?.label ?? "sin dato"}
              </span>
            </li>
          ))}
        </ul>
      )}
      {footer}
    </Block>
  );
}

function mustText(skill: FitSkill): string {
  if (skill.mustCount === 0) return "";
  return skill.mustCount === 1 ? " (en 1 es excluyente)" : ` (en ${skill.mustCount} es excluyente)`;
}

/** Tres hechos del mercado público de la carrera, en «de cada 10». */
function marketFacts(market: CareerMarket, fit: FitData): string[] {
  const total = market.total;
  const facts: string[] = [];
  const advanced = market.english.levels.avanzado + market.english.levels.fluido;
  const cefr = fit.profile.englishCefr;
  const estimated = market.english.estimated ? " (estimado)" : "";
  facts.push(
    `De cada 10 ofertas, ${perTen(advanced, total)} piden inglés avanzado o más${estimated}.` +
      (cefr ? ` Tu inglés cargado es ${cefr}.` : ""),
  );
  facts.push(`De cada 10 ofertas, ${perTen(market.volume.modality.remoto, total)} son remotas.`);
  const { junior, semi, senior, lead } = market.seniority.counts;
  facts.push(
    `Por nivel, de cada 10 ofertas (aprox.): ${perTen(junior, total)} para junior, ${perTen(semi, total)} semi senior, ${perTen(senior, total)} senior y ${perTen(lead, total)} lead. En el resto, el aviso no aclara el nivel.`,
  );
  if (fit.profile.country === "AR") {
    facts.push(
      `De cada 10 ofertas, ${perTen(market.volume.fromArgentina.acepta, total)} aceptan gente de Argentina (estimado).`,
    );
  }
  return facts;
}

function MarketBlock({
  market,
  label,
  fit,
}: {
  market: CareerMarket;
  label: string;
  fit: FitData;
}) {
  return (
    <Block id="encaje-mercado-titulo" testId="encaje-mercado" title="Tu carrera en el mercado">
      {market.total === 0 ? (
        <p data-testid="encaje-vacio-mercado" className={MUTED}>
          Todavía no hay ofertas públicas de {label} en los últimos 30 días.{" "}
          <Link href="/market" className="underline">
            Mirá otra carrera en Mercado
          </Link>
        </p>
      ) : (
        <>
          <p className="text-xs text-zinc-600">
            Sobre {offersText(market.total)} públicas de {label} de los últimos 30 días.
          </p>
          <ul className={LIST}>
            {marketFacts(market, fit).map((fact) => (
              <li key={fact} className="min-w-0 break-words text-sm text-zinc-700">
                {fact}
              </li>
            ))}
          </ul>
          <Link href={`/market?carrera=${market.role}`} className={LINK}>
            Ver el mercado de {label}
          </Link>
        </>
      )}
    </Block>
  );
}
