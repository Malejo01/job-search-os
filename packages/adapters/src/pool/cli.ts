import { inferRoleHints, type RawJob } from "@job-search-os/pipeline";
import { fetchAshbyBoard } from "../sources/ashby";
import {
  ATS_MAX_JOBS_PER_BOARD,
  atsStatusOf,
  type AtsBoardResult,
  type AtsProvider,
} from "../sources/ats-common";
import { fetchGetOnBoardJobs, GOB_POOL_CATEGORIES } from "../sources/getonboard";
import { fetchGreenhouseBoard } from "../sources/greenhouse";
import { fetchHimalayasJobs } from "../sources/himalayas";
import { fetchJobicyJobs } from "../sources/jobicy";
import { fetchLeverBoard } from "../sources/lever";
import { fetchRemoteOkJobs } from "../sources/remoteok";
import { describeFailure } from "../sources/error-code";
import { sourceUserAgent } from "../sources/user-agent";
import { fetchWwrJobs, parseWwrFeed, WWR_POOL_CATEGORIES } from "../sources/wwr";
import {
  countriesLine,
  fieldPresence,
  formatFieldReport,
  languageLine,
  parsePoolCliArgs,
  type PoolCliArgs,
  type PoolCliSource,
} from "./field-report";

/**
 * Prueba en seco de una fuente del pool (JS-137):
 *   pnpm pool:fetch <getonboard|remoteok|jobicy|himalayas|wwr> --dry-run
 *   pnpm pool:fetch <greenhouse|lever|ashby> <token> [--region eu] [--company "Nombre"] --dry-run
 * Descarga UNA vez con el User-Agent identificable y ventana de 48 h (los ATS no tienen ventana:
 * traen todo lo abierto, hasta ATS_MAX_JOBS_PER_BOARD por board), y reporta conteos y qué campos
 * trae la respuesta real contra los que lee el mapper. Los ATS consultan ese board SIN leer `ats_boards`. No escribe en ninguna base
 * (no importa @job-search-os/db) y nunca imprime títulos, empresas, URLs ni textos.
 */
type SourceName = PoolCliSource;
type AtsArgs = Extract<PoolCliArgs, { ok: true; token: string }>;

const SINCE_HOURS = 48;
/** Variables que mira `sourceUserAgent()` para armar el host del User-Agent. */
const USER_AGENT_VARS = ["APP_URL", "NEXT_PUBLIC_APP_URL", "AUTH_URL"];
/** Páginas de Himalayas en una prueba manual: su documentación pide una consulta por día. */
const HIMALAYAS_DRY_RUN_PAGES = 3;

/** Campos que lee cada mapper, para contrastar con la respuesta real. */
const MAPPER_FIELDS: Record<SourceName, readonly string[]> = {
  getonboard: [
    "id",
    "title",
    "remote",
    "remote_modality",
    "remote_zone",
    "countries",
    "location_tenants",
    "company",
    "modality",
    "seniority",
    "tags",
    "min_salary",
    "max_salary",
    "published_at",
    "applications_count",
    "lang",
    "description",
    "functions",
    "desirable",
    "benefits",
    "links",
  ],
  remoteok: [
    "id",
    "position",
    "company",
    "epoch",
    "date",
    "location",
    "salary_min",
    "salary_max",
    "url",
    "apply_url",
    "tags",
    "description",
  ],
  jobicy: [
    "id",
    "url",
    "jobTitle",
    "companyName",
    "jobIndustry",
    "jobType",
    "jobGeo",
    "jobLevel",
    "jobDescription",
    "pubDate",
    "salaryCurrency",
    "annualSalaryMin",
    "annualSalaryMax",
  ],
  himalayas: [
    "guid",
    "title",
    "companyName",
    "applicationLink",
    "locationRestrictions",
    "minSalary",
    "maxSalary",
    "currency",
    "seniority",
    "employmentType",
    "categories",
    "description",
    "pubDate",
  ],
  wwr: ["title", "link", "guid", "pubDate", "region", "category", "type", "description"],
  greenhouse: [
    "id",
    "title",
    "absolute_url",
    "location",
    "first_published",
    "updated_at",
    "departments",
    "content",
  ],
  lever: [
    "id",
    "text",
    "hostedUrl",
    "categories",
    "workplaceType",
    "createdAt",
    "description",
    "descriptionPlain",
    "lists",
    "additional",
    "additionalPlain",
    "salaryRange",
  ],
  ashby: [
    "id",
    "title",
    "jobUrl",
    "location",
    "secondaryLocations",
    "department",
    "team",
    "isListed",
    "isRemote",
    "workplaceType",
    "employmentType",
    "descriptionPlain",
    "descriptionHtml",
    "publishedAt",
    "compensation",
  ],
};

/** Items crudos de una respuesta JSON, según la forma de cada fuente. */
function rawItemsOf(source: SourceName, body: unknown): unknown[] {
  if (source === "remoteok") return Array.isArray(body) ? body.slice(1) : [];
  if (source === "lever") return Array.isArray(body) ? body : [];
  if (body === null || typeof body !== "object") return [];
  if (source === "getonboard") {
    const data = (body as { data?: unknown }).data;
    return Array.isArray(data)
      ? data.map((d: { id?: unknown; attributes?: object; links?: unknown }) => ({
          id: d?.id,
          ...d?.attributes,
          links: d?.links,
        }))
      : [];
  }
  const jobs = (body as { jobs?: unknown }).jobs;
  return Array.isArray(jobs) ? jobs : [];
}

/** `fetch` que guarda los items crudos de cada respuesta sin alterarla. */
function capturingFetch(source: SourceName, sink: unknown[]): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const res = await fetch(input, init);
    try {
      if (source === "wwr") sink.push(...parseWwrFeed(await res.clone().text()).items);
      else sink.push(...rawItemsOf(source, await res.clone().json()));
    } catch {
      // Cuerpo que no es JSON: el adaptador informa el error a su manera
    }
    return res;
  }) as typeof fetch;
}

const ATS_FETCHERS = {
  greenhouse: fetchGreenhouseBoard,
  lever: fetchLeverBoard,
  ashby: fetchAshbyBoard,
} satisfies Record<AtsProvider, unknown>;

/** Los N slugs más frecuentes de la taxonomía de la fuente, normalizados, con su conteo. */
function topSlugs(values: Iterable<string>, limit: number): string {
  const counts = new Map<string, number>();
  for (const v of values) {
    const slug = v
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    // Cada slug impreso se corta a 40 caracteres
    const short = slug.slice(0, 40);
    if (short) counts.set(short, (counts.get(short) ?? 0) + 1);
  }
  const top = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
  return top.length ? top.map(([k, n]) => `${k}=${n}`).join(", ") : "ninguno";
}

/**
 * Conteos de pistas de puesto (iguales a las del upsert) y de taxonomía de la fuente. Solo
 * conteos y slugs de categoría/tag: nunca títulos ni textos del aviso.
 */
function hintLines(source: SourceName, jobs: readonly RawJob[]): string[] {
  const perRole = new Map<string, number>();
  let withHint = 0;
  for (const job of jobs) {
    const roles = inferRoleHints({
      sourceKind: job.source.kind,
      title: job.title,
      tags: job.tags,
      categories: job.categories,
    });
    if (roles.length) withHint++;
    for (const role of roles) perRole.set(role, (perRole.get(role) ?? 0) + 1);
  }
  const lines = [
    `con pista de puesto: ${withHint} / ${jobs.length}`,
    `por puesto: ${[...perRole].map(([k, n]) => `${k}=${n}`).join(", ") || "ninguno"}`,
    languageLine(jobs),
    countriesLine(jobs),
  ];
  if (source === "jobicy") {
    lines.push(
      `categorías de la fuente (top 20): ${topSlugs(
        jobs.flatMap((j) => j.categories ?? []),
        20,
      )}`,
    );
  }
  if (source === "remoteok") {
    lines.push(
      `tags de la fuente (top 20): ${topSlugs(
        jobs.flatMap((j) => j.tags ?? []),
        20,
      )}`,
      `seniority inferida: ${jobs.filter((j) => j.seniority).length} / ${jobs.length}`,
    );
  }
  return lines;
}

async function run(source: SourceName, ats?: AtsArgs): Promise<void> {
  const userAgent = sourceUserAgent();
  const since = new Date(Date.now() - SINCE_HOURS * 3_600_000);
  const raw: unknown[] = [];
  const fetchImpl = capturingFetch(source, raw);
  const lines: string[] = [];
  let mapped: number;
  let jobs: readonly RawJob[];

  if (ats) {
    let r: AtsBoardResult;
    try {
      r = await ATS_FETCHERS[ats.source]({
        token: ats.token,
        region: ats.region,
        companyName: ats.company,
        userAgent,
        fetchImpl,
      });
    } catch (e) {
      console.log(`board ${ats.source}/${ats.token}: error (${atsStatusOf(e)})`);
      process.exitCode = 1;
      return;
    }
    jobs = r.jobs;
    mapped = jobs.length;
    lines.push(
      `estado del board: ${r.status}`,
      `vistos: ${r.seen}`,
      `filtrados por no remoto: ${r.filteredNonRemote}`,
      `salteados (estructura incompleta): ${r.skipped}`,
      `recortados por tope (${ATS_MAX_JOBS_PER_BOARD}): ${r.truncated}`,
    );
    if (r.unlisted !== undefined) lines.push(`no listados (isListed=false): ${r.unlisted}`);
  } else if (source === "wwr") {
    const r = await fetchWwrJobs({
      since,
      categories: WWR_POOL_CATEGORIES,
      partialOnError: true,
      userAgent,
      fetchImpl,
    });
    jobs = r.jobs;
    mapped = jobs.length;
    lines.push(`vistos: ${r.seen}`, `salteados: ${r.skipped}`);
    lines.push(
      `categorías con error: ${r.errors.length ? r.errors.join("; ") : "ninguna"}`,
      "(un HTTP 404 en una categoría = slug a corregir en WWR_POOL_CATEGORIES)",
    );
  } else if (source === "getonboard") {
    const r = await fetchGetOnBoardJobs({
      since,
      categories: GOB_POOL_CATEGORIES,
      remoteOnly: false,
      skipMissingCategories: true,
      userAgent,
      fetchImpl,
    });
    jobs = r.jobs;
    mapped = jobs.length;
    lines.push(`páginas descargadas: ${r.pagesFetched}`, `vistos: ${r.seen}`);
    lines.push(
      `categorías faltantes (404): ${r.missingCategories.length ? r.missingCategories.join(", ") : "ninguna"}`,
    );
  } else if (source === "remoteok") {
    const r = await fetchRemoteOkJobs({ since, userAgent, fetchImpl });
    jobs = r.jobs;
    mapped = jobs.length;
    lines.push(`vistos: ${r.seen}`, `salteados: ${r.skipped}`);
    lines.push(
      r.legal
        ? `texto legal: sí (${r.legal.length} caracteres; no se imprime)`
        : "texto legal: no vino en el elemento [0]",
    );
  } else if (source === "jobicy") {
    const r = await fetchJobicyJobs({ since, userAgent, fetchImpl });
    jobs = r.jobs;
    mapped = jobs.length;
    lines.push(`vistos: ${r.seen}`, `salteados: ${r.skipped}`);
  } else {
    const r = await fetchHimalayasJobs({
      since,
      maxPages: HIMALAYAS_DRY_RUN_PAGES,
      userAgent,
      fetchImpl,
    });
    jobs = r.jobs;
    mapped = jobs.length;
    lines.push(`páginas descargadas: ${r.pagesFetched}`, `vistos: ${r.seen}`);
    lines.push(`salteados: ${r.skipped}`);
  }

  const hasHost = userAgent.includes("(+");
  console.log(
    `fuente: ${source}${ats ? `/${ats.token}${ats.region ? ` (región ${ats.region})` : ""}` : ""}  (${ats ? `todo lo abierto, tope ${ATS_MAX_JOBS_PER_BOARD} por board` : `ventana ${SINCE_HOURS} h`}, User-Agent con host: ${hasHost ? "sí" : "no"})`,
  );
  if (!hasHost) {
    console.log(
      `  sin host: se miraron ${USER_AGENT_VARS.join(", ")} y ninguna es una URL http(s) válida en este entorno`,
    );
  }
  console.log(
    ats
      ? `abiertos (remotos, tras el tope): ${mapped}`
      : `mapeados dentro de la ventana: ${mapped}`,
  );
  for (const l of lines) console.log(l);
  for (const l of hintLines(source, jobs)) console.log(l);
  console.log(`\ncampos de la respuesta cruda (${raw.length} items) que lee el mapper:`);
  console.log(formatFieldReport(fieldPresence(raw, MAPPER_FIELDS[source]), raw.length));
}

async function main(): Promise<void> {
  const parsed = parsePoolCliArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(parsed.error);
    process.exitCode = 1;
    return;
  }
  await run(parsed.source, "token" in parsed ? parsed : undefined);
}

main().catch((error: unknown) => {
  console.error(`pool:fetch falló: ${describeFailure(error)}`);
  process.exit(1);
});
