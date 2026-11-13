# Capacidad para la beta: 25 personas (C7-14)

Estimación con el código de `ronda/integracion-c7` (2/11/2026) para la beta cerrada. Se calculó para **25 cuentas** (el cupo de entonces más 2 cuentas de admin/prueba). Solo código y docs: no se tocó ninguna variable. Donde no hay medición real, el número es una cota y lo dice.

> **Actualización del 5/11 (cupo y becas):** el cupo pasó a ser de **15 a 20 personas**, con un becado gratis y dos con 50 % de descuento (ya no «3 becadas»). Detalle y puntos abiertos en `docs/beta/runbook-apertura.md`, «Decisiones del 5/11»; no está claro si las dos personas que no pagan entran en esos lugares: [A CONFIRMAR con Mauro]. **No se recalculó nada:** las cuentas de abajo siguen estimadas para 25 y no se agregó ningún dato nuevo.

## Resumen

| Recurso | Límite | Uso estimado (25 personas) | ¿Alcanza? |
|---|---|---|---|
| IA (evaluación de ofertas) | `LLM_DAILY_CAP_USD` (hoy 2 en `.env.example`) | **USD 0,5 a 2,4 por día** (realista a peor caso) | **Justo en el peor caso**: subir a 4 |
| Cola de evaluación | 50 por corrida × 4 corridas por día = **200 evaluaciones por día** | 75 a 345 por día | **No en el peor caso**: ver «Cuello de botella» |
| Neon, transferencia | 5 GB por mes (plan gratis) | 1,5 a 4 GB por mes (sin contar el mercado por carrera, ver abajo) | **Justo**: medir el 3/11 y cada semana |
| Resend, envíos | 100 por día, 3.000 por mes (plan gratis) | 5 a 35 por día | Sí, con margen |
| Resend, entrantes (alertas reenviadas) | confirmar si cuentan en el cupo (ver abajo) | 50 a 100 por día | **Riesgo** si cuentan |
| Vercel, builds | Hobby | 1 a 3 por día (push a `main`); previews solo con `[preview]` | Sí |

## 1. IA: llamadas y costo

**Qué llama a la IA y cuánto cuesta** (tarifas de `packages/db/seeds/model_routing.json`, costos medidos en `docs/LLM_COSTOS.md`):

| Tarea | Cuándo | Costo por llamada | Tope que ya existe |
|---|---|---|---|
| `evaluate_job` | Una por oferta asignada a una persona (pool, email, pegada a mano) | **USD 0,0068** medido (≈ 2.000 tokens de entrada, ≈ 420 de salida, sin thinking) | Por plan: **15 por día** (Beta) y **3** (gratis), en `PLANS` (pipeline); por persona: `LLM_USER_DAILY_CAP_USD` (default USD 1); global: `LLM_DAILY_CAP_USD` |
| `extract_skills` | Una por oferta nueva del pool (no por persona) | ≈ USD 0,007 (mismo modelo, salida más larga) | Global |
| `parse_email_fallback` | Solo si el parser de un email falla | ≈ USD 0,0005 | Global |
| `cv_interview` / `cv_write` | Charla para armar el CV (`CV_CHAT_ENABLED=all`) | ≈ USD 0,0015 por turno, ≈ 0,002 por redacción | Por persona: USD 0,30 por día; global: `CV_CHAT_DAILY_CAP_USD` (default USD 1) |
| Demo semanal (`/api/cron/demo`) | Lunes | — | USD 1 por semana |

**Por persona y por día:**
- Peor caso (Beta, el pool tiene ofertas de sobra): 15 evaluaciones × USD 0,0068 = **USD 0,10**.
- Realista para las carreras de la beta: el pool trae pocas ofertas nuevas por día para abogacía, administración, comunicación o relaciones internacionales (abogacía tenía 17 vigentes en 30 días el 1/11). Con 2 a 4 ofertas nuevas por día más las alertas reenviadas: **3 a 6 evaluaciones, USD 0,02 a 0,04**.

**Para las 25 personas, por día:**

| Escenario | Evaluaciones | USD evaluación | + `extract_skills` | + charla de CV | Total por día | Por mes (30 días) |
|---|---|---|---|---|---|---|
| Realista | 75 | 0,51 | ≈ 0,20 (≈ 30 ofertas nuevas del pool) | 0 a 0,5 | **≈ USD 0,7 a 1,2** | **≈ USD 21 a 36** |
| Peor caso (23 personas en Beta al tope) | 345 | 2,35 | ≈ 0,35 | hasta 1 (tope) | **≈ USD 3,7** | **≈ USD 110** |

Con `LLM_DAILY_CAP_USD=2` (el valor de `.env.example`), el peor caso se frena a mitad de día: lo no evaluado vuelve a la cola y sale al día siguiente (no se pierde, se atrasa). El tope se mide sobre 24 h móviles e incluye a todas las tareas.

## 2. Cuello de botella: la cola de evaluación

El cron (`.github/workflows/cron.yml`) corre `/api/cron/evaluate` **cada 6 horas**, y cada corrida evalúa **hasta 50** ofertas (`EVALUATE_LIMIT` en `apps/web/app/api/cron/evaluate/route.ts`, en serie, ≈ 3 s cada una: ≈ 150 s de los 240 s de presupuesto). Son **200 evaluaciones por día como máximo**.

- Realista (75 por día): alcanza.
- Peor caso (345 por día): la cola crece ≈ 145 por día. Las ofertas se ven, pero sin puntaje («en cola») hasta horas o días después.
- Pegar una descripción o cargar una oferta a mano evalúa en el momento (no espera al cron).

**Si en la primera semana la cola crece** (mirarlo en `/settings/metricas` o con `pnpm llm:spend`), dos cambios, los dos de **carril rojo** (los decide Mauro, no van en este PR):
1. Sumar una corrida de `evaluate` cada hora en `cron.yml` (solo el paso `evaluate`, sin ingesta): pasa a 24 × 50 = 1.200 por día. GitHub Actions lo permite; cada corrida es una invocación de Vercel de ≈ 2,5 minutos.
2. O subir `EVALUATE_LIMIT` a 75 (≈ 225 s, al límite del presupuesto de 240 s). Menos recomendable: queda poco margen.

## 3. Neon: transferencia (egress)

Límite del plan gratis: **5 GB por mes** (≈ 165 MB por día). No hay medición por persona todavía: lo de abajo sale del código y de la auditoría (`docs/neon/auditoria-consultas.md`, con lo ya arreglado en C5-7 y C6-3).

**Por persona y por día** (cotas, con uso diario):

| Qué | Cuánto | Cuántas veces | MB por día |
|---|---|---|---|
| Pantallas con sesión (`/hoy`, `/jobs`, detalle, ajustes) | 20 a 120 KB por carga | 10 a 20 cargas | 0,5 a 2 |
| Evaluación (leer oferta y perfil, escribir el resultado) | ≈ 40 KB | 3 a 15 | 0,1 a 0,6 |
| Asignación diaria del pool (candidatas con columnas acotadas, C6-3) | ≈ 0,3 a 1 MB | 1 | 0,3 a 1 |
| Mercado de la persona (`/market`, caché de 6 h) | ≈ 1 MB | 1 a 4 | 1 a 4 (con caché, casi siempre 1) |
| **Total** | | | **≈ 2 a 5 MB** |

**25 personas: ≈ 50 a 125 MB por día, ≈ 1,5 a 3,8 GB por mes.**

**Fijo, sin importar cuántas personas:**
- Ingesta del pool (4 veces por día) y dedup (shingles de 14 días por oferta entrante, propuesta 7 de la auditoría, no se hizo): ≈ 15 a 90 MB por día según cuántas ofertas entren.
- **Mercado por carrera** (`readCareerMarketInput`, propuesta 1, no se hizo): el texto de los avisos para medir el inglés, con caché. La auditoría lo estimó en 140 a 720 MB por día con revalidación cada 30 min; hoy las páginas públicas son ISR de 1 hora y el panel de mercado de la app cachea. **Es la incógnita más grande**: si está cerca de la cota alta, por sí solo pasa los 5 GB por mes.

**Qué hacer:** correr `docs/neon/neon-stats.sql` (solo lectura, en el editor de Neon) el 3/11 y cada lunes, y mirar «Data transfer» en el panel de Neon. Si a mitad de mes va arriba de 2,5 GB, la acción es la propuesta 1 de la auditoría (persistir el idioma y el nivel de inglés del aviso al ingerir), que está en la ronda del 3/11. Plan B: el plan Launch de Neon.

## 4. Resend: emails

Plan gratis: **100 envíos por día y 3.000 por mes**, compartidos por todo lo que manda la app.

| Email | Cuándo | Por día con 25 personas |
|---|---|---|
| Recuperar contraseña | A pedido (uno cada 5 min como máximo por persona) | 0 a 5 |
| «Tu plan vence» (C4-1) | 3 días antes del vencimiento, una vez | 0 a 25 el día que vencen juntos; tope `PLAN_NOTICE_DAILY_CAP` (30) |
| Soporte («¿Algo no anduvo?») | Por reporte, **uno por cada admin** de `ADMIN_EMAILS` | 0 a 10 (con 2 admins, 0 a 5 reportes) |
| Invitaciones | **No usan Resend**: el panel arma el texto y lo mandás vos | 0 |

**Total: 5 a 35 por día.** Alcanza con margen.

**Entrantes:** cada persona reenvía sus alertas de empleo (LinkedIn, Indeed, Get on Board, Computrabajo) a su dirección `u_<token>@` del dominio de ingesta: 2 a 4 emails por persona por día, **50 a 100 por día**. **Confirmar en el panel de Resend si los emails recibidos cuentan en el cupo de 100 por día del plan gratis.** Si cuentan, con 25 personas se llega al tope y los envíos (recuperación, avisos) empiezan a fallar: pasar a Resend Pro (50.000 por mes) antes del 26/11.

## 5. Vercel: builds y funciones

- **Builds:** cada push a `main` construye producción (≈ 3 a 4 min). Las previews solo se construyen con `[preview]` en el último commit (CLAUDE.md). Con 1 a 3 merges por día, sin problema.
- **Funciones:** los crons son 4 corridas de ingesta + evaluación por día (≈ 2 a 4 min cada una), uno diario de avisos y dos semanales. Las páginas públicas son ISR de 1 hora. 25 personas no mueven estos números de forma sensible.

## 6. Variables que Mauro tiene que cargar (Vercel, producción)

| Variable | Valor sugerido | Por qué |
|---|---|---|
| `LLM_DAILY_CAP_USD` | **4** | Cubre el peor caso de evaluación (USD 2,35) + skills + margen. Por mes, como máximo ≈ USD 120 |
| `LLM_USER_DAILY_CAP_USD` | **1** (default, no hace falta cargarla) | 15 evaluaciones por día son USD 0,10: el tope solo frena un uso raro |
| `CV_CHAT_DAILY_CAP_USD` | **2** si `CV_CHAT_ENABLED=all` | Con 25 personas, el default de USD 1 se agota con 3 o 4 charlas en el mismo día |
| `PLAN_NOTICE_DAILY_CAP` | **30** (default) | 25 personas entran en un solo día |
| `PRICING_ENABLED` | `1` (de build: redeploy) | `/precios` y «Tu plan» |
| `MP_LINK_LISTA` | el link de Mercado Pago del plan Beta, de la **cuenta nueva compartida** (5/11: hay que actualizar los `MP_LINK_*`) | Va solo en el mensaje de invitación (C7-12) |
| `WAITLIST_INVITE_CAP` | **20** (default) | Una tanda de 20 invitaciones por vez |
| `TARGET_ROLES_FREE_LIMIT` | **2** (default) | Puestos del plan gratis |

**Defaults en código:** no cambié ninguno. Todos los topes de arriba ya existen; ninguno falta del todo.

## 6b. Umbrales de `/settings/salud` (R8-7)

La pantalla muestra diez señales con nivel verde, amarillo, rojo o gris (sin dato). Todas salen de datos que ya existen; conteos agregados, sin datos de nadie. Los umbrales viven en `packages/pipeline/src/beta-health.ts`; esta tabla es la referencia.

| Señal | Verde | Amarillo | Rojo | Gris |
|---|---|---|---|---|
| Cola de evaluación | menos de 50 y la más vieja de menos de 6 h | más de 50, o más de 6 h | más de 200, o más de 24 h | |
| Gasto de IA (24 h) | menos del 50 % del tope | 50 % o más | 90 % o más | sin tope |
| Emails enviados hoy | menos de 50 | 50 o más | 80 o más | |
| Errores de ingesta (24 h) | menos de 3 | 3 o más | 10 o más | |
| Personas activas hoy | 1 o más | | | ninguna |
| «Contanos qué pasó» (24 h) | ninguno | 1 o más | | |
| **Evaluaciones fallidas (24 h)** (`job_queue`, `evaluate_job`, `failed`) | menos de 3 | 3 a 10 | más de 10, o más de la mitad de las terminadas (con 4 o más) | |
| **Última descarga del pool** (`public_job_fetches` con estado `ok` o `partial`, ventana de 7 días) | hasta 7 h | más de 7 h | más de 13 h | ninguna en 7 días |
| **Emails sin parser (7 días)** (`inbound_emails` con motivo «sin parser» o «remitente no esperado») | menos de 5 | 5 o más | 30 o más | |
| **Invitaciones sin usar** (`invitations`, sin canjear y sin vencer) | hay y ninguna vence pronto | alguna vence en 48 h | | ninguna |

Notas:
- La fila de emails sin parser nombra solo portales de empleo conocidos (Computrabajo, Bumeran, ZonaJobs, Jooble, InfoJobs, Workana, Glassdoor, Indeed, LinkedIn, Get on Board); cualquier otro remitente cuenta como «otros».
- Los cortes de evaluaciones fallidas y de pool son los mismos que usa `/api/cron/status` para el monitor externo.

## 7. Qué mirar la primera semana (26/11 en adelante)

1. `pnpm llm:spend --days 7` (o `/settings/metricas`): USD por día y por tarea.
2. Cuántas ofertas quedan «en cola» a la noche: si crece día a día, aplicar el punto 2 (cron cada hora).
3. Neon: «Data transfer» del mes y `docs/neon/neon-stats.sql`.
4. Resend: envíos del día y, si los entrantes cuentan, el total.
