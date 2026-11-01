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
   - La selección de chips por persona se guarda desde C3-3 (ver «Elección de la persona»); cómo filtra queda para una ronda posterior.
6. **Separación por título, no por prefiltro** (ADR-022 §2). `TITLE_TERMS` conservadores —nunca «sueldo», «administrador/a», «internacional», «relaciones», «contract», «legal» ni «trade» sueltos— con `TITLE_EXCLUSIONS` y `VETO_TERMS` por carrera:
   - **Exclusiones por término** (`TERM_EXCLUSIONS`, nuevas): una palabra anula una sola frase del puesto y no toda la carrera. Evita perder títulos buenos: «Pharma Compliance Officer» sale, pero «Abogado» con el mismo texto no; «Auditor de calidad ISO» sale de contaduría, pero «Contador» no.
   - abogacía veta a engineer, developer, software o sistemas; administración, a los mismos cuatro, y es la más genérica (puede llegar a `MAX_ROLE_HINTS`); comunicación, a telecom e ingeniería; relaciones internacionales, a sales y data. Los vetos solo actúan si el título no nombra el puesto.
   - «Relaciones laborales» no es término de abogacía: encaja parcialmente, pero es RRHH.
   - «Ejecutivo de cuentas» no es término de marketing: la regla del spec (solo con «agencia») no se puede expresar con frases contiguas, y sin ella es ventas.
   - En comunicación, «redes» no se excluye suelto (lo usan «redes sociales»): se excluyen «redes de datos», «redes de comunicaciones», «redes ip» y «redes móviles».
   - «Relaciones institucionales» y «public affairs» suman hint a marketing y a relaciones internacionales; compliance suma a abogacía (compliance officer) y a contaduría (AML analyst); prensa, a comunicación y a marketing (PR); control de gestión, a contaduría y a administración. Ninguna de esas áreas veta.

7. **Prefiltro** (carril rojo):
   - «abogad» deja de descartar para quien eligió `abogacia`, y «administrativ» también para `administracion_empresas` (`exemptFor`);
   - Brand Manager, Assistant Brand Manager, PR Manager y Communications Manager (marketing), Communications Manager y PR Manager (comunicación) y Legal Manager (abogacía) entran a `ROLE_OWN_TITLE_PHRASES`. Liberan solo «manager»; «Head of», «Director» y «Lead» siguen bloqueando;
   - **multinivel para todas las carreras:** en el título descarta una frase («sé/ser tu propio jefe», «oportunidad de negocio», «ingresos/ganancias extra», «emprendedor/a independiente», «multinivel», «network marketing»...). En el texto del aviso hace falta una frase de núcleo (el eslogan, multinivel, network marketing) más otra, o cuatro distintas: «oportunidad de negocio» e «ingresos extra» aparecen en avisos comerciales normales. Un título de tecnología no se descarta por el texto. Usa la razón `disciplina_distinta` con un mensaje propio;
   - licencias (`licensing.ts`): «cpacf» y los colegios públicos de abogados de Buenos Aires son alias de Argentina. «Colegio de abogados» a secas no: hay uno en cada país;
   - el golden y el adversarial no cambian de resultado (probado y con test permanente).
8. **Fuentes:** `SOURCE_CATEGORY_ROLES` mapea las categorías no técnicas de Jobicy (`legal`, `accounting-finance`, `marketing`, `copywriting`, `management`, `business`, `project-management`, `admin-support`) y de WWR (`remote-sales-and-marketing-jobs`, `remote-management-and-finance-jobs`). La categoría `admin` de Jobicy es DevOps y no se mapea. Como esas categorías juntan carreras, `title-fit.ts` suma vetos cruzados: administración y contaduría se vetan entre sí, administración veta ventas, y marketing veta ventas. El adapter que pide las categorías es de otro PR.
9. **Skills:** 8 a 12 por carrera nueva en `role_skills.json`, con la regla de ADR-023: dos skills no comparten término, así que las skills que ya existen se reutilizan en vez de duplicarse.

## Datos y orden de aplicación
- **0048 (generada):** amplía `waitlist_role_check` con las cuatro claves. También se suman a `admin_founder_counts()` (`rls/0012`), que tiene la lista fija: sin eso los cupos de fundador las contarían como «sin carrera».
- **0049 (custom, idempotente):** las 30 skills nuevas, todas de `dominio` (9 de abogacía, 6 de administración, 7 de comunicación y 8 de relaciones internacionales). Las carreras comparten las ya existentes (`negotiation`, `excel`, `project_planning`, `client_facing`, `english_fluent`...).
- **Orden:** `pnpm db:migrate`, después el merge y el deploy. Son pura expansión: antes del deploy el código viejo ignora las claves nuevas.
- Después: `pnpm pool:rehint --remote`, primero sin `--apply` y después con `--apply`, y la auditoría de títulos que pide ADR-023 antes de sacar una clave de `UNLISTED_ROLE_KEYS`.

## Elección de la persona (C3-3)
- **Dónde:** `profiles.target_specialties`, `jsonb` nullable (migración 0054). Forma: `{ "<carrera>": ["<id de área>", …] }`, solo para las carreras que la persona **acotó**. `null`, o una carrera sin entrada, es «Todas las áreas». Marcar todos los chips equivale a no marcar ninguno y se guarda como `null`. La base solo acota la forma (objeto, hasta 8 KB); el contenido se valida en código.
- **RLS:** no hace falta policy nueva. Es una columna de `profiles`, que ya tiene `profiles_owner` (`user_id = auth.uid()`, con `FORCE`); la persona la lee y la escribe sola.
- **Validación** (`skills/specialty-selection.ts`, pura): `parseSpecialtyEntries` lee los `carrera:área` que manda el formulario y `normalizeTargetSpecialties` deja solo las carreras elegidas que tienen áreas, solo ids del catálogo (en su orden) y solo si acotan. Un valor raro falla cerrado a «todas».
- **Cómo se guarda:** el onboarding y «Tus puestos» (Ajustes) mandan un campo oculto `specialties` por chip marcado, y nada si es «Todas las áreas». «Tu perfil» (Ajustes) no manda puestos ni áreas y no las pisa. Si la persona saca una carrera, sus áreas se van con ella.
- **Cómo filtraría** (no implementado): en `pool/select.ts`, después de asignar `matchedRole` a una oferta, descartar (razón nueva, p. ej. `area`) la que `jobMatchesSpecialties(título, carrera, selección)` rechace. Un título que ningún chip nombra nunca se descarta. Toca la selección del pool, el ranking y `pool:explain`, y el golden/adversarial del prefiltro: va con evals y con su propio ticket.

## Consequences
- **El evaluador no tiene disciplina para estas carreras** (límite de ADR-015). Un aviso de abogacía puede salir como «otra disciplina» aunque sea la carrera elegida. El código no lo deshace sin tocar el prompt, que pide evals y gasto.
- **Administración de empresas es la más genérica.** Con títulos como «analista» o «jefe de» puede dar falsos positivos. Si tras `pool:rehint` aparecen avisos con más de `MAX_ROLE_HINTS` carreras, se vuelve a ajustar con la misma auditoría.
- **Contaduría y abogacía comparten áreas** (impuestos, compliance, prevención de lavado): un mismo aviso puede sumar hint a las dos. Es intencional.
- **Los chips no filtran todavía.** La elección se guarda (C3-3), pero ni el pool ni el prefiltro la leen: usarla en la selección es una ronda aparte, con su propio ticket.
- El golden por carrera (evals con avisos reales) queda para la tanda siguiente; esta no gasta LLM.
