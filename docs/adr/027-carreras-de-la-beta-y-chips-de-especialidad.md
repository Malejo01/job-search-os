# ADR-027: Carreras de la beta y chips de especialidad

**Status:** Accepted · **Date:** 2026-10-30 · Amplía ADR-022 y ADR-023 (carreras no técnicas, licencias de otro país y carreras «sin listar»).

## Context
La beta cerrada (ADR-024) se arma con personas de carreras universitarias y terciarias que no son tecnología: contaduría, derecho, administración, comunicación, marketing y relaciones públicas, y relaciones internacionales. Hoy solo dos de esas seis tienen carrera propia (`finanzas_contabilidad` y `marketing_digital`), y las dos se quedan cortas: faltan sueldos, costos, auditoría y tributaria en la primera, y marca, investigación de mercado y relaciones públicas en la segunda. Las otras cuatro caen en «sin carrera» o en una vecina.

Además, una carrera de estas es muy ancha. «Contaduría» abarca sueldos, impuestos y auditoría, que son oficios con avisos distintos. La persona necesita decir en cuál trabaja sin que el catálogo de carreras (y el tope de 2 puestos del plan gratis) se multiplique.

## Decision
1. **Cuatro carreras nuevas**, siempre al final de `ROLE_KEYS` (el orden de las existentes no cambia):
   - `abogacia`, «Abogacía y legales»;
   - `administracion_empresas`, «Administración de empresas»;
   - `comunicacion`, «Comunicación y prensa»;
   - `relaciones_internacionales`, «Relaciones internacionales y comex». El rótulo del spec («… y comercio exterior») pasa el máximo de 40 caracteres de `roleSkillsSchema`; gana el código y se acorta.
2. **Dos carreras existentes se amplían sin cambiar la clave** (precedente ADR-022 §3, ADR-019: renombrar cuesta alias, redirect y backfill por una clave que solo se ve en la URL):
   - `finanzas_contabilidad` → «Contaduría, impuestos y finanzas»;
   - `marketing_digital` → «Marketing y relaciones públicas».
3. **Dos grupos nuevos en el selector**, sin mover las carreras que ya estaban:
   - «Derecho, contabilidad y gestión»: `abogacia` y `administracion_empresas`;
   - «Comunicación y relaciones»: `comunicacion` y `relaciones_internacionales`.

   `finanzas_contabilidad` sigue en «Finanzas y operaciones» y `marketing_digital` en «Carreras digitales». Moverlas es un cambio de una línea en `ROLE_GROUPS` si Mauro lo prefiere.
4. **Las cuatro nuevas salen sin listar** (`UNLISTED_ROLE_KEYS`, ADR-022 §7). La regla pide 10 o más ofertas en 30 días y hoy ninguna fuente del pool trae avisos de estas carreras; el volumen se mide después de `pool:rehint` con las fuentes de C1-6 y de Gemini. Mientras tanto no aparecen en el selector, en los chips de `/mercado` ni en el sitemap; quien la tenga la conserva y su página responde. Publicar una es un PR de una línea.
5. **Chips de especialidad** (`skills/specialties.ts`, `ROLE_SPECIALTIES`):
   - Son subespecialidades de una carrera, no carreras: no tienen clave en `ROLE_KEYS`, no cuentan para el tope de puestos y no cambian `role_hints`. Sirven para que la persona acote su carrera.
   - Cada chip lleva un `id` estable (snake_case), un rótulo y los términos de título que lo nombran.
   - **Invariante:** la unión de los `terms` de los chips de una carrera es exactamente `TITLE_TERMS[role]` (test de cobertura). Un término nuevo del título tiene que caer en algún chip, y un chip no promete un título que la carrera no reconoce. Un término puede estar en más de un chip.
   - Un chip puede no tener términos. «Sector público» u «ONG y comunidad» no se leen del título y se eligen por otra señal. Otros (costos, marca, prensa...) salen vacíos en este PR solo porque `TITLE_TERMS` todavía no tiene sus frases: las suma C1-3, y el test de cobertura obliga a que lleguen a un chip.
   - **Contaduría (10):** Impuestos · Sueldos · Contabilidad y balances · Auditoría · Costos · Presupuesto y control de gestión · Tesorería, pagos y cobranzas · Prevención de lavado y compliance · Concursos y pericias judiciales · Sector público.
   - **Marketing y RR.PP. (11):** Marketing digital y anuncios · Redes y contenidos · Marca · Trade marketing y puntos de venta · Investigación de mercado · CRM y e-commerce · Agencia y medios · Prensa · Eventos y ceremonial · Relaciones institucionales · RSE y sustentabilidad.
   - Los chips de las otras cuatro carreras se agregan junto con su clave.
   - La selección de chips por persona (dónde se guarda y cómo filtra) queda para una ronda posterior; esta solo fija el catálogo.
6. **Separación por título, no por prefiltro** (ADR-022 §2). `TITLE_TERMS` conservadores —nunca «sueldo», «administrador/a», «internacional», «relaciones», «contract» ni «legal» sueltos— con `TITLE_EXCLUSIONS` y `VETO_TERMS` por carrera:
   - abogacía veta a quien trae engineer, developer, software o sistemas;
   - administración, a engineer, developer, software y sistemas, y es la más genérica (puede llegar a `MAX_ROLE_HINTS`);
   - comunicación, a telecom e ingeniería;
   - relaciones internacionales, a sales y data.

   Las áreas compartidas (compliance, prensa, relaciones institucionales, control de gestión) suman hint en varias carreras y no vetan.
7. **Prefiltro:**
   - «abogad» deja de descartar para quien eligió `abogacia`, y «administrativ» también para `administracion_empresas` (`exemptFor`);
   - los títulos propios del oficio que dicen «manager» (Brand Manager, Assistant Brand Manager, PR Manager, Communications Manager y Legal Manager) entran a `ROLE_OWN_TITLE_PHRASES`;
   - regla de multinivel para todas las carreras: «sé tu propio jefe», «oportunidad de negocio», «ingresos extra» y «emprendedor/a independiente» descartan. Es el ruido típico de las categorías no técnicas;
   - licencias (`licensing.ts`): «cpacf» y «colegio de abogados» son alias de Argentina.
   - El golden y el adversarial no pueden cambiar de resultado.
8. **Fuentes:** `SOURCE_CATEGORY_ROLES` mapea las categorías no técnicas de Jobicy (legal, accounting-finance, marketing, copywriting, management, business, project-management, admin-support) y de WWR (`remote-sales-and-marketing-jobs`, `remote-management-and-finance-jobs`). Va al revés de lo que parece en un caso: la categoría `admin` de Jobicy es DevOps y no se mapea. El adapter que las pide es de otro ticket.
9. **Skills:** 8 a 12 por carrera nueva en `role_skills.json`, con la regla de ADR-023: dos skills no comparten término, así que las skills que ya existen se reutilizan en vez de duplicarse.

## Datos y orden de aplicación
- Una migración **generada** que amplía `waitlist_role_check` con las cuatro claves.
- Una migración **custom, idempotente**, con las skills nuevas (como ADR-019 a ADR-023).
- **Orden:** `pnpm db:migrate`, después el merge y el deploy. Son pura expansión: antes del deploy el código viejo ignora las claves nuevas.
- Después: `pnpm pool:rehint --remote`, primero sin `--apply` y después con `--apply`, y la auditoría de títulos que pide ADR-023 antes de sacar una clave de `UNLISTED_ROLE_KEYS`.

## Consequences
- **El evaluador no tiene disciplina para estas carreras** (límite de ADR-015). Un aviso de abogacía puede salir como «otra disciplina» aunque sea la carrera elegida. El código no lo deshace sin tocar el prompt, que pide evals y gasto.
- **Administración de empresas es la más genérica.** Con títulos como «analista» o «jefe de» puede dar falsos positivos. Si tras `pool:rehint` aparecen avisos con más de `MAX_ROLE_HINTS` carreras, se vuelve a ajustar con la misma auditoría.
- **Contaduría y abogacía comparten áreas** (impuestos, compliance, prevención de lavado): un mismo aviso puede sumar hint a las dos. Es intencional.
- **Los chips no filtran todavía.** El catálogo y su invariante quedan; guardar la elección y usarla en la selección es una ronda aparte.
- El golden por carrera (evals con avisos reales) queda para la tanda siguiente; esta no gasta LLM.
