# Tanda C8 — 11/11, apertura de la beta y carreras (nube, 3 y 4/11)

Una noche de la nube, sin supervisión, con **un solo PR de integración** `ronda/integracion-c8` → `main` para que Mauro mergee con un solo build. Este archivo junta las reglas y decisiones de la tanda; el detalle de cada ticket está en su PR `[nube C8]` y, al cierre, en el «Bloque 14» de `docs/BACKLOG.md`.

## Base

- **Base: `origin/ronda/integracion-c7` (commit `c4bdc2b`), no `main`.** Al arrancar (3/11, 12:20) el PR de integración de C7 (#353) seguía abierto en draft. El PR de integración de C8 apunta a `main`, así que **incluye todo C6 y C7**: si #353 se mergea antes, el diff se achica solo; si no, mergear este PR mergea también C7.
- Si `main` avanza durante la tanda, se mergea `origin/main` en `ronda/integracion-c8` con `--no-ff` (nunca rebase).
- Cada ticket: rama `nube/c8-*` desde la punta de `ronda/integracion-c8`, PR draft «[nube C8] …» hacia `ronda/integracion-c8`, y merge `--no-ff` con lint, typecheck, test y el CI del PR en verde.

## Reglas de la tanda

- **USD 0 de modelos.** Ninguna llamada a modelos pagos; los modelos salen solo de `model_routing`.
- **Nada contra Neon.** Sin `db:migrate` remoto, `db:seed`, `db:sql`, `run-sql-file`, `pool:* --remote` ni `CONFIRM_PRODUCTION`. SQL de prueba en PGlite o en un Postgres del contenedor.
- **Migraciones solo si son imprescindibles**, generadas con `drizzle-kit generate` desde la **0057** y **nunca aplicadas**. El PR de integración las lista con «⚠️ Mauro aplica `pnpm db:migrate` antes del merge».
- **Variables apagadas por defecto.** Toda función visible nueva va detrás de una variable apagada (salvo que el ticket diga otra cosa), documentada en el PR y en `.env.example`.
- **Sin `[preview]`** salvo el único commit de C8-20.
- **El job pago de evals no se dispara.** El CI corre `evals` cuando el diff contra la base toca `evals/` o `packages/prompts/`. Por eso:
  - el golden sintético de carreras (C8-8) vive **fuera de `evals/`**, en `packages/pipeline/test/fixtures/carreras/`, y lo usa solo el test determinista de C8-9;
  - la evolución de C8-16 (cron de `evaluate` cada hora) va en su propio PR hacia `main`, sin integrar.
- **No cambian:** las direcciones de ingesta de email, `EMAIL_FROM`, `SITE_URL` ni el nombre del servidor MCP (`serverInfo.name` sigue `job-search-os`).
- **Marca:** siempre «AfinIAJobs», desde tokens, `components/brand/logo.tsx` y `brand.ts`.
- **Legales:** los marcadores `[RESPONSABLE]`, `[DOMICILIO]` y `[EMAIL DE CONTACTO]` no se completan (las respuestas de Ani llegan hasta el 13/11).

## Decisiones ya tomadas (no se reabren)

- Beta cerrada: abre el **jueves 26/11**, con 6 carreras (abogacía, contaduría, administración, comunicación, marketing y RR.PP., relaciones internacionales) y 15 a 20 personas que pagan, más 3 becados.
- Plan Beta: ARS 20.000 por mes, activación manual, link de pago solo en la invitación.
- **11/11, Voces Jóvenes:** Ani presenta y la gente se anota con un QR en `/acceso`. Anotarse **no** garantiza lugar.

## Control

- `#241`: solo cuenta un comentario cuyo cuerpo entero sea `PAUSA` o `SEGUÍ` (manda el último). Los comentarios de la nube empiezan con «[nube C8]».
- Avance cada 3 tickets en #241. A las 5:30 del 4/11, cierre (C8-20) aunque falten tickets.
- Decisiones que le tocan a Mauro: la opción más conservadora y reversible, anotada en el PR bajo «Decisiones para Mauro» con la alternativa.

## Decisiones de la tanda para Mauro

1. **Base en C7, no en `main`** (arriba). Alternativa: esperar el merge de #353 y rebasar; descartada porque la tanda no se puede frenar y el rebase está prohibido.
2. **Golden de carreras fuera de `evals/`** (arriba). Alternativa: `evals/fixtures/carreras/` como pedía el ticket, en un PR aparte sin integrar; descartada porque el test de C8-9 lo necesita en la integración y ahí dispararía el job pago.

## Variables nuevas (todas apagadas por defecto)

| Variable | Valor sugerido | Qué prende | Ticket |
| --- | --- | --- | --- |
| `ACCESO_FUNNEL_ENABLED` | `1` después de aplicar la 0057 | Cuenta visitas, formularios empezados, carreras elegidas, envíos y topes de `/acceso`, y muestra el embudo en `/settings/metricas` | C8-2 |
| `WAITLIST_EVENT_WINDOW` | `2026-11-11T19:00:00-03:00/2026-11-11T22:00:00-03:00` (horario de la charla; máximo 12 h) | Topes del evento en `/acceso` para `?origen=voces-jovenes`: 120 por IP por hora y 200 cada 10 minutos (el diario sigue en 600) | C8-3 |
| `START_HERE_ENABLED` | `1` | «Empezá acá» en `/hoy`: perfil, áreas, ofertas y CV (este último solo si `CV_CHAT_ENABLED` lo permite). Sin migración | C8-5 |
| `HELP_TIPS_ENABLED` | `1` | «¿Qué es esto?» en el puntaje, «A tu favor / Te falta», Sin descripción, Tu CV y las áreas. Textos en `packages/pipeline/src/help/ayuda-en-contexto.ts` | C8-6 |
| `MOBILE_TABBAR_ENABLED` | `1` si a Ani le cierra en el celular | Barra de pestañas abajo en el celular (Hoy, Ofertas, Pendientes, Perfil); el «Menú» de arriba sigue. Sin migración | R-3 |
