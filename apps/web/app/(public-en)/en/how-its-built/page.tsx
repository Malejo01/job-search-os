import { BRAND } from "@job-search-os/pipeline";
import Link from "next/link";
import { getPoolShowcase } from "@/lib/showcase";
import { FlowDiagram, FLOW_STEPS_EN } from "../../../(public)/como-esta-hecho/flow-diagram";
import { PoolNumbers } from "../../../(public)/mercado/pool-numbers";

// ISR (ronda 63): la CPU de Vercel no alcanza para una consulta por visita
export const revalidate = 3600;
export const metadata = {
  title: "How it's built",
  description:
    "How a job posting goes from source to decision: AI evaluates, rules in code decide, and the person chooses. Stack, safeguards and public code.",
  alternates: {
    canonical: "/en/how-its-built",
    languages: { es: "/como-esta-hecho", en: "/en/how-its-built" },
  },
};

const REPO_URL = BRAND.repoUrl;
const PRINCIPLES_URL = `${REPO_URL}/blob/main/docs/ARCHITECTURE.md`;

// Mismo conteo fijo que la página en español (aproximado, al 20/10/2026)
const TESTS_LABEL = "More than 2,000 automated tests";
const TESTS_AS_OF = "October 20, 2026";

const SAFEGUARDS = [
  [
    "Golden set",
    "A set of postings with the correct answers agreed in advance. Every prompt change is measured against it, with strict and lenient metrics, before it ships.",
  ],
  [
    "Validated output",
    "The model must answer in a fixed format, validated against a schema (Zod). If it doesn't, the call is retried or discarded.",
  ],
  [
    "Rules live in code",
    "Years of experience, English level, country and per-title ceilings are applied after the model, with tests. The model cannot talk the system into applying, and the system never applies for you: the person decides.",
  ],
  [
    "Prompt injection",
    "A posting can carry hidden instructions meant to fool the AI. The posting text is data, not instructions: the system detects when a posting tries to give orders to the evaluator, and that posting's score is capped.",
  ],
  [
    "Cost cap",
    "Daily spending limits apply per person and overall, are enforced in code, and every call is logged.",
  ],
  [
    "Emails are parsed safely",
    "If a forwarded email doesn't have the expected structure, it goes to manual review. Nothing is partially extracted. The HTML is shown isolated, with no scripts or navigation.",
  ],
];

const STACK = [
  ["Web", "Next.js (App Router), strict TypeScript and Tailwind."],
  [
    "Data",
    "Postgres with Row Level Security (RLS), so each person sees only their own data, and Drizzle.",
  ],
  ["AI", "Vercel AI SDK. The model is picked from a routing table, with a fallback."],
  [
    "Quality",
    "Vitest, Playwright, integration tests against a real Postgres and a CI with a secret scanner.",
  ],
  ["Infra", "Vercel and Neon, with scheduled jobs in GitHub Actions."],
];

const CTA_CLASS =
  "inline-flex min-h-11 items-center justify-center rounded-md bg-zinc-900 px-5 text-base font-medium text-white";
const LINK_CLASS = "inline-flex min-h-11 items-center underline";

export default async function HowItsBuiltPage() {
  const showcase = await getPoolShowcase();
  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-2 py-4">
        <p>
          <Link href="/como-esta-hecho" hrefLang="es" lang="es" className={LINK_CLASS}>
            Español
          </Link>
        </p>
        <h1 className="text-3xl font-semibold sm:text-4xl">How it&apos;s built</h1>
        <p className="max-w-2xl text-base text-zinc-700">
          A system that reads job postings and evaluates them against a profile. The AI model
          evaluates; rules in code decide; the person chooses. Here is how it works, in detail.
        </p>
      </header>

      <section aria-labelledby="journey" className="flex flex-col gap-4">
        <h2 id="journey" className="text-xl font-semibold">
          The journey of a posting
        </h2>
        <FlowDiagram lang="en" />
        <ol className="flex max-w-3xl flex-col gap-3" aria-label="The journey, step by step">
          {FLOW_STEPS_EN.map((step, i) => (
            <li
              key={step.title}
              className="flex min-w-0 gap-3 rounded-md border border-zinc-200 bg-white p-4"
            >
              <span
                aria-hidden="true"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-sm font-semibold text-white"
              >
                {i + 1}
              </span>
              <div className="min-w-0 text-sm leading-relaxed text-zinc-800 sm:text-base">
                <p className="font-semibold">{step.title}</p>
                <p>{step.text}</p>
                {step.note ? <p className="mt-1 italic">{step.note}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="no-invention" className="flex flex-col gap-3">
        <h2 id="no-invention" className="text-xl font-semibold">
          How the AI is kept from making things up
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {SAFEGUARDS.map(([title, text]) => (
            <li key={title} className="min-w-0 rounded-md border border-zinc-200 bg-white p-4">
              <p className="font-semibold">{title}</p>
              <p className="text-sm leading-relaxed text-zinc-700 sm:text-base">{text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="stack" className="flex flex-col gap-3">
        <h2 id="stack" className="text-xl font-semibold">
          Stack
        </h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          {STACK.map(([label, text]) => (
            <div key={label} className="min-w-0 rounded-md border border-zinc-200 bg-white p-4">
              <dt className="font-semibold">{label}</dt>
              <dd className="text-sm leading-relaxed text-zinc-700 sm:text-base">{text}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="live" className="flex flex-col gap-3">
        <h2 id="live" className="text-xl font-semibold">
          Live numbers
        </h2>
        <PoolNumbers showcase={showcase} lang="en" />
        <p data-testid="tests-count" className="text-sm text-zinc-700">
          {TESTS_LABEL} (as of {TESTS_AS_OF}).
        </p>
      </section>

      <section aria-labelledby="code" className="flex flex-col gap-3">
        <h2 id="code" className="text-xl font-semibold">
          The code
        </h2>
        <p className="text-sm text-zinc-700">The code is public. Read it on GitHub.</p>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-800">
          <a href={REPO_URL} target="_blank" rel="noopener" className={LINK_CLASS}>
            GitHub repository
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          <a href={PRINCIPLES_URL} target="_blank" rel="noopener" className={LINK_CLASS}>
            Design principles
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </p>
      </section>

      <section className="flex flex-col items-start gap-3 py-2">
        <p className="text-base font-semibold">Looking for a tech job?</p>
        <Link href="/acceso" hrefLang="es" lang="es" className={CTA_CLASS}>
          <span lang="en">Request access</span>
        </Link>
      </section>
    </div>
  );
}
