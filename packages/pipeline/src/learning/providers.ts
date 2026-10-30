/**
 * Proveedores del catálogo de aprendizaje (diseño 121 §1, E1b). Se enlaza, no se copia: de cada
 * uno guardamos título, URL y horas, nunca contenido. La ficha de cada proveedor está en
 * `docs/sources/learning.md`. Ningún proveedor se chequea solo hasta que Mauro lea sus términos y
 * se anote la fecha en `termsReviewedAt`: hasta entonces el modo efectivo es `manual`.
 */
export type LearningAccess = "free" | "free_account" | "audit" | "paid";
export type LinkCheckMode = "auto" | "manual";

export type LearningProvider = {
  key: string;
  name: string;
  /** Hosts propios; también cuentan sus subdominios. */
  hosts: readonly string[];
  access: LearningAccess;
  langs: readonly ("es" | "en")[];
  /** Lo que propone el diseño; solo rige con `termsReviewedAt`. */
  proposedCheckMode: LinkCheckMode;
  /** Fecha (AAAA-MM-DD) en que Mauro leyó los términos; null = a verificar. */
  termsReviewedAt: string | null;
};

const provider = (
  key: string,
  name: string,
  hosts: readonly string[],
  access: LearningAccess,
  langs: readonly ("es" | "en")[],
  proposedCheckMode: LinkCheckMode,
): LearningProvider => ({
  key,
  name,
  hosts,
  access,
  langs,
  proposedCheckMode,
  termsReviewedAt: null,
});

export const LEARNING_PROVIDERS: readonly LearningProvider[] = [
  // Documentación oficial
  provider("mdn", "MDN Web Docs", ["developer.mozilla.org"], "free", ["es", "en"], "auto"),
  provider("react_docs", "React", ["react.dev"], "free", ["es", "en"], "auto"),
  provider("nextjs_docs", "Next.js", ["nextjs.org"], "free", ["en"], "auto"),
  provider("typescript_docs", "TypeScript", ["typescriptlang.org"], "free", ["es", "en"], "auto"),
  provider("python_docs", "Python", ["docs.python.org"], "free", ["es", "en"], "auto"),
  provider("postgresql_docs", "PostgreSQL", ["postgresql.org"], "free", ["en"], "auto"),
  provider("docker_docs", "Docker", ["docs.docker.com"], "free", ["en"], "auto"),
  provider("kubernetes_docs", "Kubernetes", ["kubernetes.io"], "free", ["es", "en"], "auto"),
  provider("pro_git", "Pro Git", ["git-scm.com"], "free", ["es", "en"], "auto"),
  provider("github_docs", "GitHub Docs", ["docs.github.com"], "free", ["es", "en"], "auto"),
  provider("opentelemetry_docs", "OpenTelemetry", ["opentelemetry.io"], "free", ["en"], "auto"),
  // Plataformas gratuitas
  provider("freecodecamp", "freeCodeCamp", ["freecodecamp.org"], "free", ["es", "en"], "auto"),
  provider(
    "microsoft_learn",
    "Microsoft Learn",
    ["learn.microsoft.com"],
    "free",
    ["es", "en"],
    "auto",
  ),
  provider(
    "aws_skill_builder",
    "AWS Skill Builder",
    ["skillbuilder.aws"],
    "free_account",
    ["en"],
    "manual",
  ),
  provider(
    "google_skillshop",
    "Google Skillshop",
    ["skillshop.withgoogle.com"],
    "free_account",
    ["es", "en"],
    "manual",
  ),
  provider(
    "google_cloud_skills",
    "Google Cloud Skills Boost",
    ["cloudskillsboost.google"],
    "free_account",
    ["es", "en"],
    "manual",
  ),
  provider(
    "hubspot_academy",
    "HubSpot Academy",
    ["academy.hubspot.com"],
    "free_account",
    ["es", "en"],
    "manual",
  ),
  provider(
    "salesforce_trailhead",
    "Salesforce Trailhead",
    ["trailhead.salesforce.com"],
    "free_account",
    ["es", "en"],
    "manual",
  ),
  provider("scrum_guides", "Scrum Guides", ["scrumguides.org"], "free", ["es", "en"], "manual"),
  provider(
    "cisco_skills_for_all",
    "Cisco Skills for All",
    ["skillsforall.com"],
    "free_account",
    ["es", "en"],
    "manual",
  ),
  provider("kaggle_learn", "Kaggle Learn", ["kaggle.com"], "free_account", ["en"], "manual"),
  provider(
    "the_odin_project",
    "The Odin Project",
    ["theodinproject.com"],
    "free",
    ["en"],
    "manual",
  ),
  // Solo en modo audit o como complemento: se asume que los términos prohíben el acceso
  // automatizado (a verificar)
  provider("coursera", "Coursera (audit)", ["coursera.org"], "audit", ["es", "en"], "manual"),
  provider("edx", "edX (audit)", ["edx.org"], "audit", ["es", "en"], "manual"),
  provider(
    "youtube",
    "YouTube (canales oficiales)",
    ["youtube.com", "youtu.be"],
    "free",
    ["es", "en"],
    "manual",
  ),
  // Fuera del catálogo (pagos): se listan para reconocerlos, nunca se chequean
  provider("datacamp", "DataCamp", ["datacamp.com"], "paid", ["es", "en"], "manual"),
  provider("platzi", "Platzi", ["platzi.com"], "paid", ["es"], "manual"),
  provider("udemy", "Udemy", ["udemy.com"], "paid", ["es", "en"], "manual"),
];

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Proveedor dueño de la URL: host exacto o subdominio (`www.` incluido). */
export function providerForUrl(
  url: string,
  providers: readonly LearningProvider[] = LEARNING_PROVIDERS,
): LearningProvider | null {
  const host = hostOf(url);
  if (!host) return null;
  return providers.find((p) => p.hosts.some((h) => host === h || host.endsWith(`.${h}`))) ?? null;
}

const REVIEWED_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Modo de chequeo que rige para una URL. Falla cerrado: `manual` sin proveedor, sin una fecha
 * válida de términos leídos o si el acceso no es `free` (con cuenta, audit o pago nunca van solos).
 * No valida el esquema: el verificador pasa antes por `isCheckableUrl`.
 */
export function checkModeForUrl(
  url: string,
  providers: readonly LearningProvider[] = LEARNING_PROVIDERS,
): LinkCheckMode {
  const p = providerForUrl(url, providers);
  if (!p || p.access !== "free") return "manual";
  if (p.termsReviewedAt === null || !REVIEWED_DATE_RE.test(p.termsReviewedAt)) return "manual";
  return p.proposedCheckMode;
}
