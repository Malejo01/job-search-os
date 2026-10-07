# Fuente: We Work Remotely (WWR)

Adapter: `packages/adapters/src/sources/wwr.ts`. **No conectado al cron** (falta migración del enum `source_kind`: hoy devuelve `kind: "other"`, `source.name` = `WWR <categoría>` y `externalId` = `wwr:<guid>`).

> Escrito sin red (ronda 07). Todo lo de este documento sale del formato documentado conocido y está **a verificar** contra un feed real antes de conectarlo.

## Endpoint
`GET https://weworkremotely.com/categories/<categoría>.rss`, una llamada por categoría. Por defecto: `remote-programming-jobs`, `remote-back-end-programming-jobs`, `remote-full-stack-programming-jobs`, `remote-devops-sysadmin-jobs` (slugs a verificar). Filtro por fecha en cliente (`fetchWwrJobs({ since, categories?, fetchImpl, baseUrl })`); deduplica por `guid` (o `link`) entre categorías.

## Parseo
Mínimo, con expresiones regulares sobre `<item>…</item>`, sin dependencias. Soporta CDATA (literal) y texto con entidades XML (se decodifican una vez; luego `htmlToText`). Falla cerrado **por item**: sin `title`, `link` o `pubDate` válido se saltea y se cuenta en `skipped`; nunca se inventan campos.

## Mapeo campo por campo
| Fuente | RawJob | Nota |
|---|---|---|
| `title` "Empresa: Puesto" | `companyRaw` / `title` | corta en el primer `:`; sin `:` → empresa `desconocida` y título entero |
| `guid` (o `link`) | `source.externalId` = `wwr:<guid>` | |
| `link` | `source.url` | |
| `region` "Anywhere in the World" | `locationRaw` = `Remoto (<región>)`, `countriesAllowed: ["*"]` | |
| `region` otro valor ("USA Only") | `locationRaw` = `Remoto (<región>)`, `countriesAllowed: null` | el prefiltro marca el riesgo |
| `region` ausente | `Remoto (países no especificados)`, `null` | |
| (toda la fuente) | `modality: "remoto"` | |
| `type` | `contractType` | |
| `category` | `tags: [categoría]` | |
| `description` | `jdText` | `htmlToText` |
| `pubDate` (RFC 822) | `postedAt` | |
| item entero | `source.original` | XML del `<item>` tal cual, `application/rss+xml` |

Quedan `null`: salario (el RSS no lo trae), seniority, idioma, candidatos.

## A verificar contra la fuente real
- Slugs de categorías y que sigan existiendo los `.rss`.
- Presencia y nombre de `region`, `category`, `type` (son extensiones del feed, no estándar RSS).
- Forma de `title` ("Empresa: Puesto") y de `guid`.
- Si `description` viene en CDATA o escapada, y si trae el JD completo o un resumen.
- Cabeceras requeridas (`User-Agent`) y límites de frecuencia.
- Valores reales de `region` que listen países o continentes.

## Términos de uso (pendiente para riesgos)
- Atribución y uso permitido del feed: revisar antes de conectar.
- Frecuencia de consulta recomendada.

## Cómo prenderla
Agregar `wwr` a `INGEST_EXTRA_SOURCES` (docs/DEPLOY.md), tras revisar los términos de uso de arriba. En la primera corrida, mirar la respuesta del cron (`extraSources`) y los avisos ingeridos:
- Formato real contra lo marcado "a verificar": `title` ("Empresa: Puesto"), `guid` y `description`.
- Cantidad: `fetched` razonable para 24 h; si falla una categoría, el log lo dice y las demás siguen.
- Ubicación: que `region` se refleje en `countriesAllowed` o quede `null`.
- Salario: el feed no lo trae; debe quedar `null`.
