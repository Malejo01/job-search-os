# Uso diario de Job Search OS

Escrito para Mauro dentro de dos semanas, cuando no se acuerde de nada. Cubre el día típico con la app desplegada; al final está la variante local (Docker) y qué hacer cuando algo falla.

## La idea en tres líneas

1. Las ofertas entran solas (Get on Board por cron, emails reenviados a `ingest.<tu-dominio>`) o a mano (`/jobs/new`, MCP desde Claude).
2. El sistema descarta lo imposible (prefiltro), evalúa el resto con el LLM (~USD 0,001 por oferta) y propone una acción.
3. Vos decidís en la lista, pegás JDs cuando faltan, marcás qué pasó con cada postulación. Eso alimenta el mercado, el plan de formación y la calibración.

## El día típico (15–25 minutos)

| Paso | Dónde | Qué hacés | Cuánto |
|---|---|---|---|
| 1 | Mail | Mirá si GitHub avisó que el workflow `cron` falló (solo escribe cuando falla). Si no hay mail, el cron corrió. | 10 s |
| 2 | `/jobs` | Lista ordenada por score. Filtrá por acción "aplicar" y score ≥ 7. Las cajas punteadas "pre" son ofertas sin evaluar todavía (pre-score sin LLM): no las tomes como definitivas. | 5 min |
| 3 | `/jobs/[id]` | Abrí cada candidata: bloqueadores en rojo (frenan), riesgos en ámbar (avisan, sobre todo ubicación). Si vas a postular, hacelo en el sitio de la oferta y después "Marcar aplicada". Si el score te parece mal, cargá tu score humano: sirve para calibrar. | 2 min por oferta |
| 4 | `/jobs/pending-jd` | Ofertas que llegaron sin descripción completa (máximo 10 en pantalla). Abrí el aviso, copiá el snippet para Claude in Chrome, pegá la JD, guardar. Se encola sola y aparece evaluada en la próxima corrida del cron (o al toque si corrés el worker a mano). Límite humano: ≤ 5 JDs por día. | 1–2 min por JD |
| 5 | `/inbox` | Emails que llegaron y el sistema no pudo parsear (cola manual). Cada uno tiene link a "cargar a mano". Hasta que existan los parsers de LinkedIn y Get on Board (JS-021/022), acá cae todo lo que entra por email. | 1 min |
| 6 | `/applications` | Cuando una empresa responde: cambiá el resultado (entrevista, rechazo humano, rechazo automático por ubicación, oferta). También se actualiza solo si cambiás el estado desde el detalle. Arriba tenés la tasa de respuesta por banda de score y las "sorpresas". | 30 s |

Semanal (lunes, 5 minutos): `/market` para ver qué skills pide el mercado y qué te falta; `/plan` para mover ítems a "en curso" o "cerrada". El snapshot y el plan se recalculan solos los lunes a las 03:30 AR por el cron; si querés verlo antes, `pnpm market:snapshot && pnpm plan:build`.

## Desde Claude (MCP)

Con el servidor MCP conectado (`docs/DEPLOY.md`, sección MCP) podés hacer todo lo anterior conversando:

- "¿Qué ofertas hay para aplicar?" → `list_jobs` (trae score, acción, pre-score si no hay evaluación).
- "¿Cuáles están pendientes de JD?" → `list_pending_jd`, y pegar la JD con `paste_jd`.
- "Cargá esta oferta de LinkedIn: ..." → `add_job` (título, empresa, URL, ubicación, modalidad, JD si la tenés). Pasa por dedup y prefiltro igual que todo.
- "Marcá la de Empresa X como aplicada" → `set_status`.
- "¿Qué pide el mercado?" → `market_summary`.

## Qué corre solo y cuándo

| Qué | Cuándo | Dónde se ve |
|---|---|---|
| Ingesta de Get on Board (últimas 24 h) y evaluación de la cola (hasta 20) | cada 6 h: 21, 03, 09, 15 hora Argentina | GitHub › Actions › `cron`; mail solo si falla |
| Snapshot de mercado + plan de formación | lunes 03:30 AR | `/market`, `/plan` |
| Email entrante | al instante | `/inbox` (cola manual) o `/jobs` cuando haya parsers |

Guardarraíl de gasto: `LLM_DAILY_CAP_USD` (default 2) sobre las últimas 24 h. Si el cron dice `stopped: cap`, hubo más ofertas de lo normal o algo reintentó de más: mirá `pnpm llm:spend` antes de subir el tope.

## Comandos que vas a usar

Todos desde la raíz del repo. Sin `--local` van contra Neon (producción); con `--local`, contra Docker.

```bash
pnpm llm:spend --days 7
```
Gasto LLM por día, tarea y modelo. Correlo si el cron avisa `cap` o si dudás de la factura.

```bash
pnpm worker:evaluate --limit 20
```
Evalúa la cola ahora, sin esperar al cron (por ejemplo después de pegar varias JDs). Muestra la lista con score y acción, y el gasto de la tanda.

```bash
pnpm worker:requeue --job <id o prefijo> --force
```
Re-evalúa una oferta ya evaluada (después de cambiar prompt o modelo). Sin `--force` solo muestra qué haría y cuánto cuesta.

```bash
pnpm ingest:getonboard --since-hours 48
```
Ingesta manual de Get on Board si el cron estuvo caído.

```bash
pnpm market:snapshot && pnpm plan:build
```
Recalcula mercado y plan ahora.

```bash
pnpm evals run --prompt evaluate_job@v1.3.1 --subset --runs 1 --concurrency 1 --db cloud --label <nombre>
```
Solo si tocás el prompt: 14 llamadas (~USD 0,02 con flash-lite, ~0,10 con 3.5-flash). Muestra el costo estimado y frena si supera `--max-usd` (default 1). La calibración está cerrada: lo que sigue se mide en `/applications` con postulaciones reales, no contra el golden.

## Variante local (Docker)

```bash
pnpm db:up
```
Levanta Postgres local. Después, en otra terminal, `pnpm --filter @job-search-os/web dev` y entrá a `http://localhost:3000` con `mauro@job-search-os.local` / `dev-password-local`. Todo lo de arriba funciona igual agregando `--local` a los comandos (`pnpm worker:evaluate --local`, etc.). `DB_TARGET=local` ya está en el `next.config` de desarrollo.

Modo demo (sin gastar): `pnpm worker:evaluate --local --demo` evalúa con heurística y marca las evaluaciones con el badge DEMO.

## Cuando algo falla

| Síntoma | Qué mirar | Qué hacer |
|---|---|---|
| Mail de GitHub: `cron` en rojo | El log del job dice qué endpoint no respondió `ok: true` | Si es `evaluate` con `stopped: cap`, es el tope de gasto: revisá `pnpm llm:spend`. Si es 401, `CRON_SECRET` de GitHub no coincide con el de Vercel. Si es 500, `GET /api/health` en la app dice si la base o el rol están mal. |
| Una oferta quedó "prefiltrada" sin evaluar | Está en la cola pero el worker no corrió, o la cola tiene un mensaje viejo | `pnpm worker:evaluate`. Si el worker dice `failed`, el error queda en la salida. |
| La JD pegada no aparece evaluada | El worker corre cada 6 h | `pnpm worker:evaluate`, o esperá al cron. |
| Todo con badge DEMO | La app está con `LLM_DEMO=1` | Sacalo de las variables de Vercel (solo va en previews). |
| Emails que no llegan a `/inbox` | Resend › Emails muestra si recibió; Resend › Webhooks muestra si el POST a `/api/inbound` dio 401 (secret) o 500 (base) | Ver `docs/DEPLOY.md`, sección Resend. |
| "sin firma" o 401 en el webhook | `RESEND_WEBHOOK_SECRET` en Vercel no es el del webhook | Copiar el `whsec_...` de Resend. |
| Score muy distinto al tuyo en varias ofertas | `/applications`, "Modelo vs tu score" | Cargá tu score en el detalle; si el sesgo se sostiene, se ajusta el prompt con evals (`docs/LLM_COSTOS.md`). |

## Reglas que el sistema no rompe (y vos tampoco)

- No navega LinkedIn ni postula solo (ADR-004). Postulás vos, en el sitio.
- Un país excluido explícitamente nunca llega a "aplicar" sin pasar por "guardar" (tope en `decide()`).
- Un rol de otra disciplina (evaluación de IA, ML puro) bloquea y baja el score a 3 aunque el vocabulario coincida (ADR-011).
- Presencial o híbrido bloquea pero no toca el score: el trabajo puede ser el tuyo, falla dónde se hace.
