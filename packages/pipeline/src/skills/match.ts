/**
 * Normalización determinista de menciones de skills (adelanto de JS-030 sin LLM).
 * Entrada: el campo `stack` de una oferta (strings libres como "Python (Django/Flask/FastAPI)",
 * "Docker/K8s", "Vertex/LangChain deseable"). Salida: skills de la taxonomía (`skills` con
 * aliases) con `isMust`, más lo que no se pudo mapear, para que se vea y no se pierda en silencio.
 *
 * Regla: un término de la taxonomía (slug, nombre o alias) cuenta si aparece como palabra entera
 * dentro de la mención. Se prueban los términos más largos primero y se tapa el tramo matcheado,
 * así "react native" no suma también "react". Nada de similitud por letras: o está o no está.
 */
export type SkillTaxonomyEntry = { slug: string; name: string; aliases: readonly string[] };

export type SkillMention = { slug: string; isMust: boolean; rawMention: string };

export type StackMatch = {
  mentions: SkillMention[];
  /** Tramos de las menciones que no matchearon ningún término (ya sin calificadores). */
  unmapped: string[];
};

/** Marcan que la mención es deseable, no requisito. */
const OPTIONAL_RE =
  /\b(deseable|deseables|nice to have|nice|plus|opcional|preferible|preferred|bonus)\b/i;
/** Marcan requisito explícito (ya es el default; se detectan solo para limpiar el texto). */
const MUST_RE = /\(must\)|\bmust\b|excluyente|requerido|required/gi;
/** Calificadores que no son skills: años, niveles, etc. */
const QUALIFIER_RE =
  /\d+\+?\s*(años|anos|years|yrs)\b|\b(avanzado|experto|expert|básico|basico|profundo|senior|junior|sólido|solido|fuerte|productivo|intermedio)\b/gi;

export function normalizeMention(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[“”"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

export type Term = { slug: string; term: string; re: RegExp };

/** Compila la taxonomía una vez: todos los términos, más largos primero. */
export function compileTaxonomy(taxonomy: readonly SkillTaxonomyEntry[]): Term[] {
  const terms: Term[] = [];
  for (const entry of taxonomy) {
    const candidates = new Set<string>([
      entry.slug.replace(/_/g, " "),
      entry.name,
      ...entry.aliases,
    ]);
    for (const c of candidates) {
      const term = normalizeMention(c);
      if (term.length < 2) continue;
      // Palabra entera: sin letra/número pegado a los lados (permite "c#", ".net", "node.js")
      terms.push({
        slug: entry.slug,
        term,
        re: new RegExp(`(^|[^a-z0-9])(${escapeRe(term)})(?=[^a-z0-9]|$)`, "i"),
      });
    }
  }
  return terms.sort((a, b) => b.term.length - a.term.length);
}

/** Skills mencionadas en UNA entrada del stack. */
export function matchMention(
  raw: string,
  terms: readonly Term[],
): { slugs: string[]; isMust: boolean; leftover: string[] } {
  const isMust = !OPTIONAL_RE.test(raw);
  let text = normalizeMention(raw)
    .replace(OPTIONAL_RE, " ")
    .replace(MUST_RE, " ")
    .replace(QUALIFIER_RE, " ");
  const slugs: string[] = [];
  for (const t of terms) {
    const m = t.re.exec(text);
    if (!m) continue;
    if (!slugs.includes(t.slug)) slugs.push(t.slug);
    // Tapar el tramo para que un término más corto de OTRA skill no lo vuelva a contar
    const start = m.index + m[1]!.length;
    text = text.slice(0, start) + " ".repeat(m[2]!.length) + text.slice(start + m[2]!.length);
  }
  const leftover = text
    .split(/[/,;()+&]| o | y | and | or |\bcon\b|\bvia\b|\bvía\b/)
    .map((s) =>
      s
        .replace(/[^a-z0-9#.\s-]/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((s) => /[a-z]{3,}/.test(s));
  return { slugs, isMust, leftover };
}

/** Skills de una oferta a partir de su `stack`; una skill mencionada como must y como deseable queda must. */
export function matchStack(
  stack: readonly string[],
  taxonomy: readonly SkillTaxonomyEntry[] | readonly Term[],
): StackMatch {
  const terms: readonly Term[] =
    taxonomy.length && "re" in taxonomy[0]!
      ? (taxonomy as readonly Term[])
      : compileTaxonomy(taxonomy as readonly SkillTaxonomyEntry[]);
  const bySlug = new Map<string, SkillMention>();
  const unmapped: string[] = [];
  for (const raw of stack) {
    const { slugs, isMust, leftover } = matchMention(raw, terms);
    for (const slug of slugs) {
      const prev = bySlug.get(slug);
      if (!prev) bySlug.set(slug, { slug, isMust, rawMention: raw });
      else if (isMust && !prev.isMust) bySlug.set(slug, { ...prev, isMust: true });
    }
    unmapped.push(...leftover);
  }
  return { mentions: [...bySlug.values()], unmapped };
}

/**
 * Skills mencionadas en un texto largo (JD completa), por término entero, más largos primero y
 * tapando el tramo matcheado (igual que matchMention). No distingue must/deseable: en una JD la
 * posición no alcanza para saberlo sin LLM, así que se devuelven como menciones.
 */
export function extractSkillsFromText(
  text: string,
  taxonomy: readonly SkillTaxonomyEntry[] | readonly Term[],
  options: { requireContext?: boolean } = {},
): string[] {
  const terms: readonly Term[] =
    taxonomy.length && "re" in taxonomy[0]!
      ? (taxonomy as readonly Term[])
      : compileTaxonomy(taxonomy as readonly SkillTaxonomyEntry[]);
  let body = normalizeMention(text);
  // Copia sin tapar: el contexto de un término ambiguo se mira acá, no en `body` (que va perdiendo
  // los tramos ya contados).
  const pristine = body;
  const slugs: string[] = [];
  for (const t of terms) {
    const rule = options.requireContext ? CONTEXT_RULES.get(`${t.slug}:${t.term}`) : undefined;
    const global = new RegExp(t.re.source, "gi");
    let m: RegExpExecArray | null;
    let hit = false;
    while ((m = global.exec(body)) !== null) {
      const start = m.index + m[1]!.length;
      const end = start + m[2]!.length;
      global.lastIndex = end;
      if (rule && !hasContext(pristine, start, end, rule)) continue;
      hit = true;
      body = body.slice(0, start) + " ".repeat(m[2]!.length) + body.slice(end);
    }
    if (hit && !slugs.includes(t.slug)) slugs.push(t.slug);
  }
  return slugs;
}

/**
 * Skills de la JD de un aviso (pool y avisos de la persona): como `extractSkillsFromText`, pero
 * los términos ambiguos de `CONTEXT_RULES` cuentan solo con contexto. Para frases sueltas (un
 * término que devolvió el modelo, un campo `stack`) se usa la función base: ahí no hay contexto.
 */
export function extractJdSkills(
  text: string,
  taxonomy: readonly SkillTaxonomyEntry[] | readonly Term[],
): string[] {
  return extractSkillsFromText(text, taxonomy, { requireContext: true });
}

/**
 * Términos de la taxonomía que en una JD no alcanzan por sí solos (R11-9). «Growth» en «company
 * growth», «identity» en «brand identity», «make» en «make sure», «security» en «social security»,
 * «go» en «go-to-market»: una skill necesita evidencia en el texto.
 *
 * `cues`: el término cuenta solo si alguna de esas señales aparece dentro de `radius` caracteres
 * (texto ya normalizado: minúsculas, sin acentos). `deny`: si aparece, no cuenta aunque haya
 * señal. Las claves son `slug:término` tal como los compila `compileTaxonomy`. No se borra ningún
 * alias de `skills.json`: los slugs ya guardados siguen valiendo y `matchStack` (campo `stack`,
 * donde el término viene solo) no cambia.
 */
export type ContextRule = { cues: RegExp; deny?: RegExp; radius?: number };

const DEFAULT_CONTEXT_RADIUS = 60;

function hasContext(body: string, start: number, end: number, rule: ContextRule): boolean {
  const radius = rule.radius ?? DEFAULT_CONTEXT_RADIUS;
  const window = body.slice(Math.max(0, start - radius), end + radius);
  if (rule.deny?.test(window)) return false;
  return rule.cues.test(window);
}

function rules(
  slug: string,
  termsList: readonly string[],
  rule: ContextRule,
): [string, ContextRule][] {
  return termsList.map((term) => [`${slug}:${term}`, rule]);
}

export const CONTEXT_RULES: ReadonlyMap<string, ContextRule> = new Map<string, ContextRule>([
  // ── Contaduría y gestión: lo que más ensuciaba los avisos de nómina y contables ──
  ...rules("growth_marketing", ["growth"], {
    cues: /growth (marketing|hack|loop|team|lead|manager|experiment|channel|strategy|funnel)|(user|customer|product|paid|viral|subscriber) growth|acquisition|adquisicion|funnel|embudo|a\/b|experimentation|retention|conversion|\bcro\b|\bseo\b|\bsem\b|\bads\b|campaign|campana|lifecycle|performance marketing/,
  }),
  ...rules("growth_marketing", ["marketing"], {
    cues: /(digital|performance|content|product|b2b|b2c|email|growth|lifecycle|inbound|affiliate|brand) marketing|marketing (experience|strategy|strategies|campaigns?|analytics|automation|manager|specialist|plan|funnel|channels?|metrics|ops|operations|mix|digital|de performance|de contenidos|de producto)|(experience|experiencia|background|skills|conocimientos?) (in|with|en|de) marketing/,
  }),
  ...rules("growth_marketing", ["lifecycle"], {
    cues: /customer|user|email|crm|retention|growth|marketing|cliente|usuario/,
  }),
  ...rules("growth_marketing", ["funnels"], {
    cues: /marketing|sales|conversion|growth|acquisition|ads|embudo|ventas/,
  }),
  ...rules("growth_marketing", ["cro"], {
    cues: /conversion|optimi|a\/b|landing|growth|ux/,
  }),
  ...rules("iam", ["identity"], {
    cues: /identity (and|&) access|identity access|identity management|identity governance|identity provider|identity federation|identity platform|identity lifecycle|identity security|\bidp\b|\biam\b|\bsso\b|saml|oauth|\bmfa\b|ldap|okta|auth0|entra|sailpoint|least privilege|privileged access|active directory|gestion de identidades|identidad y acceso/,
  }),
  ...rules("iam", ["sod", "iga"], {
    cues: /segregation of duties|segregacion de funciones|separacion de funciones|access|acceso|identity|governance|rbac|sailpoint|saviynt/,
  }),
  ...rules("n8n", ["make"], {
    cues: /zapier|n8n|integromat|power automate|workato|pipedream|no[- ]?code|low[- ]?code|make\.com|make scenarios?|make automations?/,
    radius: 40,
  }),
  ...rules("multimodal", ["vision"], {
    cues: /computer vision|vision (model|language|transformer|api|pipeline)|\bvlm\b|multimodal|multi-modal|image|imagen|video|audio|\bocr\b|gpt-4v|gemini|\bllm\b|\bai\b|\bia\b/,
    radius: 50,
  }),
  ...rules(
    "ip_law",
    [
      "intellectual property",
      "propiedad intelectual",
      "trademark",
      "trademarks",
      "patentes",
      "derechos de autor",
    ],
    {
      cues: /\blaw\b|legal (counsel|team|department|matters|advice|affairs)|attorney|counsel|lawyer|paralegal|litigation|prosecution|infringement|licensing (agreement|deal)s?|abogad|derecho|juridic|asesor(ia|a)? legal|registr(o|ar|ation) de|trademark (registration|application|filing|clearance|search)|patent (prosecution|filing|application)|\bip (law|counsel|portfolio|attorney)|solicitud de|portfolio de (marcas|patentes)/,
    },
  ),
  ...rules("security", ["security", "seguridad"], {
    cues: /cyber|ciber|infosec|information security|seguridad de la informacion|cloud|network|application security|appsec|owasp|pentest|\bsoc\b|siem|vulnerab|encrypt|cifrad|threat|amenaza|iso 27001|soc 2|identity|firewall|malware|zero trust|devsecops|security (engineer|analyst|team|review|best practices|controls|posture|incident|audit|architect)/,
    deny: /social security|job security|security deposit|seguridad social|security guard|guardia de seguridad|seguridad e higiene|higiene y seguridad|seguridad laboral|seguridad vial|food security|security clearance/,
    radius: 50,
  }),
  ...rules("payments", ["payments", "cards", "tarjetas"], {
    cues: /payment (gateway|processor|processing|platform|system|api|infrastructure|integration|provider)|\bpci\b|\bpsp\b|acquir|issuer|fintech|stripe|adyen|card (network|processing|issuing|payments?)|tarjetas? de (credito|debito)|procesamiento de pagos|pasarela|medios de pago|iso 8583|merchant/,
  }),
  // ── Transversales: aparecen en cualquier JD sin ser la skill ──
  ...rules("client_facing", ["communication"], {
    cues: /client|customer|non[- ]?technical|no tecnic|cliente|explain|explicar|presentation|presentar/,
  }),
  ...rules("client_facing", ["stakeholders"], {
    cues: /client|customer|external|executive|non[- ]?technical|cliente|externos|no tecnic/,
  }),
  ...rules("client_facing", ["discovery"], {
    cues: /customer|client|product|user|requirements|cliente|requerimientos|workshop|calls?/,
  }),
  ...rules("go", ["go"], {
    cues: /golang|\bgo (developer|engineer|programming|services?|microservices|backend|lang|language)|kubernetes|k8s|docker|grpc|protobuf|backend|microservic|concurrency|goroutine|(python|java|rust|node\.?js|typescript|c\+\+|ruby|php|kotlin)[,/ ]+(and |or |& |y |o )?go\b|\bgo[,/ ]+(and |or |& |y |o )?(python|java|rust|node|typescript|ruby|php|kotlin)|(experience|experiencia) (in|with|en|con) go\b/,
    radius: 40,
  }),
  ...rules("rest_apis", ["rest"], {
    cues: /\bapis?\b|http|json|endpoint|restful|web service|servicios web/,
    radius: 30,
  }),
  ...rules("rest_apis", ["auth"], {
    cues: /\bapis?\b|oauth|jwt|token|login|session|sso|endpoint/,
    radius: 30,
  }),
  ...rules("nextjs", ["next"], {
    cues: /next\.js|react|vercel|ssr|app router|front-?end/,
    radius: 30,
  }),
  ...rules("nestjs", ["nest"], {
    cues: /nest\.js|nestjs|node|typescript|backend/,
    radius: 30,
  }),
  ...rules("nodejs", ["express"], {
    cues: /node|javascript|\bjs\b|middleware|backend/,
    radius: 30,
  }),
  ...rules("typescript", ["ts"], {
    cues: /typescript|node|react|angular|javascript|\bjs\b/,
    radius: 30,
  }),
  ...rules("java", ["spring"], { cues: /java|boot|kotlin|backend|jvm|framework/, radius: 30 }),
  ...rules("react_native", ["expo"], { cues: /react|native|mobile|\beas\b|\bapp\b/, radius: 30 }),
  ...rules("snowflake", ["spark"], {
    cues: /apache|databricks|pyspark|hadoop|big data|scala|etl|sql|kafka|pipelines?/,
    radius: 40,
  }),
  ...rules("aws", ["lambda", "glue", "athena"], {
    cues: /aws|amazon|serverless|\bs3\b|cloud|etl|crawler|catalog|sql/,
    radius: 40,
  }),
  ...rules("gcp", ["vertex"], { cues: /\bai\b|gcp|google|model|\bml\b/, radius: 30 }),
  ...rules("vector_db", ["chroma"], {
    cues: /vector|embedding|\brag\b|langchain|database/,
    radius: 30,
  }),
  ...rules("rag", ["retrieval"], {
    cues: /llm|vector|embedding|\brag\b|generation|semantic|\bai\b/,
    radius: 40,
  }),
  ...rules("mlops", ["drift"], {
    cues: /model|data|concept|\bml\b|monitoring|feature/,
    radius: 30,
  }),
  ...rules("microservices", ["distributed"], {
    cues: /systems?|architectures?|computing|services|databases?|tracing/,
    radius: 25,
  }),
  ...rules("microservices", ["distribuidas"], {
    cues: /sistemas|arquitecturas?|aplicaciones|servicios/,
    radius: 25,
  }),
  ...rules("observability", ["monitoring", "logging", "tracing", "alerting"], {
    cues: /application|infrastructure|system|cloud|metrics|alerts?|\blogs?\b|grafana|prometheus|uptime|\bapm\b|observab|production|servers?|\bsre\b|devops|incident|distributed/,
    deny: /monitoring and evaluation|monitoreo y evaluacion|\bm&e\b/,
    radius: 50,
  }),
  ...rules("agents", ["agentes"], {
    cues: /\bia\b|\bai\b|llm|autonomo|orquest|langgraph|langchain|inteligencia artificial|multi/,
    radius: 40,
  }),
  ...rules("agents", ["multi-step", "multi-paso"], {
    cues: /agent|llm|\bai\b|prompt|tool/,
    radius: 40,
  }),
  ...rules("amazon_connect", ["lex"], { cues: /amazon|connect|chatbot|\bbot\b|aws/, radius: 30 }),
  ...rules("ai_coding_tools", ["cursor", "factory"], {
    cues: /\bai\b|claude|copilot|codex|\bide\b|coding|droid|agents?/,
    radius: 40,
  }),
  ...rules("salesforce", ["apollo"], {
    cues: /sales|crm|outreach|prospect|lead|salesforce|hubspot/,
    radius: 40,
  }),
  ...rules("office_suite", ["outlook"], {
    cues: /microsoft|email|calendar|office|gmail|365|agenda|correo|calendario|inbox/,
    radius: 40,
  }),
  ...rules("english_fluent", ["native", "fluent", "proficient", "highest level"], {
    cues: /english|ingles/,
    radius: 40,
  }),
]);
