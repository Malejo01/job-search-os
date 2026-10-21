# ADR-021: Dos carreras de tecnología nuevas (Data Engineering y Solutions / Sales Engineering) y reglas de título para las ofertas tech sin carrera

**Status:** Accepted · **Date:** 2026-10-21 · Extiende ADR-015 y ADR-019 (mismo patrón de carreras).

## Context
El diagnóstico de la ronda 105 sobre el snapshot del pool encontró que más de la mitad de las ofertas
únicas (914 de 1752) tenía `role_hints` vacío. Una parte eran ofertas tech que ya tienen carrera pero a
las que les faltaban términos de título (DevOps, SRE, platform engineer, seguridad de la infraestructura,
lenguajes de backend, product engineer, data scientist...). Otra parte, unas 50 ofertas por snapshot, eran
roles técnicos que no pertenecían a ninguna carrera: Solutions Engineer o Architect (41), Professional
Services (9), Data Engineer (8), Field Engineer (5) y Forward Deployed (menos de 5). Abrir carreras es una
decisión de producto: Mauro decidió el 21/10 abrir **Data Engineering** y **Solutions / Sales Engineering**.

## Decision
1. **Dos `RoleKey` nuevos, al final de `ROLE_KEYS`:** `data_engineer` («Data Engineering») y
   `solutions_engineer` («Solutions / Sales Engineering»). Van en el grupo «Tecnología» del selector
   (que pasa a 10 carreras; el total, a 18). El orden de las claves existentes no cambia.
2. **Engineering manager no se abre.** Son unas 30 ofertas, pero es gestión de personas, no un oficio
   técnico con skills propias; sigue sin pista (`role_hints` vacío) y el evaluador lo mira como hasta ahora.
3. **Reglas de título para las carreras que ya existen** (`TITLE_TERMS` en `role-hints.ts`):
   - `soporte_it`: site reliability, SRE, DevOps, GitOps, platform engineer, infrastructure/infra engineer,
     IT engineer, IT systems, IT operations, desktop support. «Support engineer» solo con `technical`,
     `software`, `database` o `application` delante: suelto es soporte de producto y sigue sin mapear.
   - `ciberseguridad`: security operations/architect/researcher/infrastructure/governance, security risk
     engineer, threat intelligence, red team, incident response y una lista cerrada de `cyber`
   (cybersecurity, cyber security, cyberdefense, cyber defense, cyberops, cyber ops, cyber threat, cyber
   risk, cyber analyst, cyber engineer). No es un prefijo: «Cyber Monday Marketing Manager» no entra.
   - `backend`: rust, elixir, scala, kotlin, golang, postgres, microservices y distributed systems
     seguidos de «engineer»; software architect.
   - `fullstack`: product engineer. `ai_engineer`: research engineer. `data_analyst`: data scientist y
     product analyst.
   - Mobile, iOS, Android y «engineer» genérico **no se tocan**.
4. **Exclusiones por rol (`TITLE_EXCLUSIONS`)** para los falsos positivos que marcó el diagnóstico:
   «physical security» y «data center security» no son ciberseguridad; «manufacturing», «hardware» y
   «mechanical» anulan solo el término «product engineer» de `fullstack` («Full Stack Engineer, Hardware
   Platform» sigue siendo fullstack); «security infrastructure», «data platform» y
   «data infrastructure» no son soporte de IT (tienen su carrera); con el patrón «AI + rol técnico»
   (ML Infrastructure Engineer, AI Platform Engineer) tampoco aplica `soporte_it`.
5. **Las carreras nuevas se reconocen por título**, no por categoría de fuente (ninguna tabla de
   `SOURCE_CATEGORY_ROLES` las nombra). `titleFit` hace el cruce: `data_analyst` y `data_engineer` se
   vetan entre sí cuando la categoría de datos las junta, y «analytics engineer» pasa de `data_analyst` a
   `data_engineer`. Las exclusiones y la lista de `cyber` se aplican también en `titleFit`
   (`matchesRoleTitle`).
6. **Prefiltro (punto 2 de ADR-015).** `ROLE_DOMAIN_KEYWORDS` de `data_engineer` (etl, databricks, snowflake)
   y de `solutions_engineer` (sales engineer, presales, pre sales, solutions architect) evita que un
   `other_discipline_keywords` de la instancia descarte su oficio propio. «Solutions architect» (también
   «software architect» para `backend` y «security architect» para `ciberseguridad`) se libera de la
   blocklist por `architect` solo para esa carrera. «Lead» y «manager» siguen bloqueando.
7. **Skills.** `role_skills.json` suma las dos carreras (12 y 10 skills) con slugs que ya existen en
   `skills.json` (sql, python, etl, snowflake con spark/kafka/databricks como alias, aws, client_facing,
   rest_apis...). **No hace falta una migración de skills.**
8. **Sin cambios en el evaluador ni en los prompts.** El rótulo sale del seed.

## Migraciones y orden
- **Una migración generada** (`drizzle-kit generate`): amplía el check `waitlist_role_check` con las dos
  claves. Es solo esquema; no hay backfill porque las carreras nuevas no reemplazan ninguna clave
  anterior. `target_role` / `target_roles` / `matched_role` / `role_hints` son texto validado en código.
- **Orden: `pnpm db:migrate` → merge → deploy.** Es una expansión: aplicar el check antes garantiza que
  nadie elija la clave nueva antes de que la base la acepte. El código viejo, con el check ya ampliado,
  no se rompe (no conoce las claves y no las ofrece).
- **Después del deploy**, `pnpm pool:rehint` recalcula `role_hints` y `lang` de las ofertas vigentes con
  las reglas nuevas (sin LLM).

## Consequences
- Las dos carreras arrancan con pocos datos de mercado (28 y 55 ofertas vigentes en el snapshot del
  15/10); con menos de 10 ofertas se muestra «pocos datos».
- El tope gratis sigue en 2 puestos.
- Las reglas de `soporte_it` suman unas 50 ofertas (`platform engineer` a veces es backend, y
  `infrastructure` a veces es hardware): son pistas, las ordena `titleFit` y decide el evaluador.
- **`IT_ROLE_KEYS` no cambia.** Quien no eligió carrera no ve `data_engineer` ni `solutions_engineer`.
  Quien eligió `data_analyst` deja de recibir «data engineer», «analytics engineer» y «etl», que pasan a
  Data Engineering.
- **Falso positivo conocido:** «platform engineer» suelto va a `soporte_it`, aunque a veces sea backend,
  como en «Developer Platform» o «Payments Platform».
- **La 0035 no se puede revertir** al check anterior si ya hay filas de `waitlist` con las claves nuevas.
- Engineering manager queda sin carrera; si el uso muestra demanda, se abre en otro ADR.
- Hay un pequeño efecto en dev: un título que antes daba desarrollo genérico (frontend, backend,
  fullstack) y ahora nombra una especialidad (p. ej. «DevOps Engineer») deja de sumar esos tres.
