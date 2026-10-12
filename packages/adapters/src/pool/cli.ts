import { fetchGetOnBoardJobs, GOB_POOL_CATEGORIES } from "../sources/getonboard";
import { fetchHimalayasJobs } from "../sources/himalayas";
import { fetchJobicyJobs } from "../sources/jobicy";
import { fetchRemoteOkJobs } from "../sources/remoteok";
import { describeFailure } from "../sources/error-code";
import { sourceUserAgent } from "../sources/user-agent";
import { fieldPresence, formatFieldReport } from "./field-report";

/**
 * Prueba en seco de una fuente del pool (JS-137):
 *   pnpm pool:fetch <getonboard|remoteok|jobicy|himalayas> --dry-run
 * Descarga UNA vez con el User-Agent identificable y ventana de 48 h, y reporta conteos y qué
 * campos trae la respuesta real contra los que lee el mapper. No escribe en ninguna base (no
 * importa @job-search-os/db) y nunca imprime títulos, empresas, URLs ni textos.
 */
const SOURCES = ["getonboard", "remoteok", "jobicy", "himalayas"] as const;
type SourceName = (typeof SOURCES)[number];

const SINCE_HOURS = 48;
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
};

/** Items crudos de una respuesta JSON, según la forma de cada fuente. */
function rawItemsOf(source: SourceName, body: unknown): unknown[] {
  if (source === "remoteok") return Array.isArray(body) ? body.slice(1) : [];
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
      sink.push(...rawItemsOf(source, await res.clone().json()));
    } catch {
      // Cuerpo que no es JSON: el adaptador informa el error a su manera
    }
    return res;
  }) as typeof fetch;
}

async function run(source: SourceName): Promise<void> {
  const userAgent = sourceUserAgent();
  const since = new Date(Date.now() - SINCE_HOURS * 3_600_000);
  const raw: unknown[] = [];
  const fetchImpl = capturingFetch(source, raw);
  const lines: string[] = [];
  let mapped: number;

  if (source === "getonboard") {
    const r = await fetchGetOnBoardJobs({
      since,
      categories: GOB_POOL_CATEGORIES,
      remoteOnly: false,
      skipMissingCategories: true,
      userAgent,
      fetchImpl,
    });
    mapped = r.jobs.length;
    lines.push(`páginas descargadas: ${r.pagesFetched}`, `vistos: ${r.seen}`);
    lines.push(
      `categorías faltantes (404): ${r.missingCategories.length ? r.missingCategories.join(", ") : "ninguna"}`,
    );
  } else if (source === "remoteok") {
    const r = await fetchRemoteOkJobs({ since, userAgent, fetchImpl });
    mapped = r.jobs.length;
    lines.push(`vistos: ${r.seen}`, `salteados: ${r.skipped}`);
    lines.push(
      r.legal
        ? `texto legal: sí (${r.legal.length} caracteres; no se imprime)`
        : "texto legal: no vino en el elemento [0]",
    );
  } else if (source === "jobicy") {
    const r = await fetchJobicyJobs({ since, userAgent, fetchImpl });
    mapped = r.jobs.length;
    lines.push(`vistos: ${r.seen}`, `salteados: ${r.skipped}`);
  } else {
    const r = await fetchHimalayasJobs({
      since,
      maxPages: HIMALAYAS_DRY_RUN_PAGES,
      userAgent,
      fetchImpl,
    });
    mapped = r.jobs.length;
    lines.push(`páginas descargadas: ${r.pagesFetched}`, `vistos: ${r.seen}`);
    lines.push(`salteados: ${r.skipped}`);
  }

  console.log(
    `fuente: ${source}  (ventana ${SINCE_HOURS} h, User-Agent con host: ${userAgent.includes("(+") ? "sí" : "no"})`,
  );
  console.log(`mapeados dentro de la ventana: ${mapped}`);
  for (const l of lines) console.log(l);
  console.log(`\ncampos de la respuesta cruda (${raw.length} items) que lee el mapper:`);
  console.log(formatFieldReport(fieldPresence(raw, MAPPER_FIELDS[source]), raw.length));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const source = args.find((a) => !a.startsWith("--"));
  if (!source || !(SOURCES as readonly string[]).includes(source)) {
    console.error(`uso: pnpm pool:fetch <${SOURCES.join("|")}> --dry-run`);
    process.exitCode = 1;
    return;
  }
  if (!args.includes("--dry-run")) {
    console.error("pool:fetch: solo existe el modo --dry-run");
    process.exitCode = 1;
    return;
  }
  await run(source as SourceName);
}

main().catch((error: unknown) => {
  console.error(`pool:fetch falló: ${describeFailure(error)}`);
  process.exit(1);
});
