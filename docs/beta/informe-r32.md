# Informe de la tanda R32 «Inventario y alta»

Cierre de la R32 (26/11). Especificación: `docs/beta/plan-r30-r34.md` §10; tickets: `docs/beta/prompt-r32.md`. Los pasos para el responsable del proyecto están en `docs/beta/pasos-manuales-r32.md`; el estado del informe de revisión, en `docs/beta/verificacion-informe-ani.md` (la R32 no cambia ninguna fila: el informe no trae IDs para esta tanda). **Costo en modelos de la tanda: USD 0** (ningún modelo, ningún pedido a un portal ni a una API de empleo; todo con fixtures inventadas).

**Por qué esta tanda:** de los avisos vigentes del pool, muy pocos están en español o aceptan gente de Argentina, y varias de las 8 carreras de la beta tienen menos de 10. La tanda arma lo que hace falta para medir el inventario por carrera, abrir cada carrera recién cuando tenga con qué y sumar inventario local. **Nada abre solo:** el panel informa y el responsable decide. `BETA_OPENS_AT` y `BETA_FECHA_DEFINITIVA` no se tocaron.

## Qué entró por ticket

**R32-01 · Carrera obligatoria.** El paso de puestos del alta suma «Otra» con texto libre (2 a 60 caracteres, sin HTML ni enlaces); sin puesto y sin «Otra» no guarda. A las cuentas anteriores sin carrera se les pide una sola vez, con un recuadro arriba de la pantalla en la que estén (no redirige ni tapa nada); «Ahora no» también cuenta como pedida. «Otra» nunca entra a un prompt ni abre una carrera.

**R32-02 · Panel de cobertura.** Reglas puras en `packages/pipeline` (`career-coverage.ts`): *vigente* (la fuente la mostró en los últimos 7 días), *tomable* (acepta Argentina, su región o todo el mundo de forma explícita, o el lugar de trabajo está en Argentina; sin países no cuenta) y *para quien empieza* (la señal del chip «Para empezar» de la R30, contada solo entre las tomables). `/admin/cobertura`: por carrera, vigentes, tomables, para quien empieza, en español y de qué fuentes; semáforo contra el umbral (30 y 10) y tendencia de 14 días si los datos alcanzan. Una sola consulta de solo lectura, sin índice ni migración nuevos. La checklist de `/admin/apertura` lee este estado carrera por carrera.

**R32-03 · Apertura por carrera.** La lista de carreras abiertas vive en la base (tablas `open_careers` y `career_opening_events`, funciones `SECURITY DEFINER`), la cambia un admin desde `/admin/carreras` y cada cambio real queda con quién y cuándo. Regla pura `careerAccess`: la cuenta anterior está siempre «dentro» (la lista vacía no cierra nada); la alta nueva de una carrera abierta entra; la de una cerrada, «Otra» o sin carrera va a la lista de espera. En `/acceso`, quien se anota de una carrera que no abrió lee «Todavía estamos sumando ofertas de {carrera}. Te avisamos por email apenas abra».

**R32-04 · Pocas ofertas y guía de alertas.** En `/jobs`, un aviso por carrera cuando hay menos de 5 ofertas en su idioma esta semana, con dos caminos (la guía de alertas o cargar una oferta); «Ahora no» lo oculta 3 días. La guía de alertas (Ajustes y onboarding) agrupa las palabras por carrera y suma un «Paso a paso» por portal que cierra con cómo hacer que esos emails lleguen a la app. Por cada portal, «Te llegaron N ofertas de {portal} en los últimos 30 días».

**R32-05 · Fuentes listas para prender.** Jooble (ADR-039): atribución «vía Jooble» en el detalle y `pool:fetch jooble --dry-run` (2 consultas del tope diario). ReliefWeb (ADR-028): topes de pedidos (como mucho 10 de hasta 100 avisos; 4 de 50 por defecto), filtro por Argentina y la región, falla cerrado ante una forma inesperada, valor propio `reliefweb` en `source_kind`, cableado al pool y atribución CC BY. Computrabajo (ADR-043): sin cambios de código, un test más. Una línea por fuente en `docs/sources/`. Todas apagadas.

**R32-06 · Empresas regionales.** Propuesta de 25 filas por carrera, **sin verificar** y privada (en `ops/`, fuera del repo). Hallazgo: los ATS del pool solo guardan avisos remotos declarados.

**R32-07 · Lector de Get on Board.** Cada motivo de la cola manual empieza con un código estable (`contrato_desconocido`, `sin_avisos` con conteos de tarjetas, destacados y links, etc.). Corrige una lectura de montos con decimales. Tabla de códigos en `docs/sources/getonboard.md`.

**R32-08 · Sueldo en la moneda original.** Columnas nuevas (mínimo, máximo, moneda y periodicidad) en `jobs` y `public_jobs`. La pantalla muestra lo que el aviso publica («$ 1.200.000 a $ 1.500.000 por mes (ARS)»); una equivalencia en dólares, si existe, va aparte y dice que es aproximada. Los lectores y adaptadores que extraen sueldo guardan también el original; lo ya guardado queda como está. Sin moneda dicha, no hay sueldo original.

**R32-09 · Email de novedades.** Como mucho semanal, solo si hay ofertas nuevas de la carrera de la persona, detrás de `NEWS_EMAIL` (apagada por defecto; `testers` o encendida) y con tope diario. Cron en `/api/cron/news-email` (el paso semanal del `cron.yml` lo agrega el responsable). Baja en un clic sin sesión en `/novedades/baja` con un token firmado (`{id}.{vence}.{firma}`, 90 días, comparación en tiempo constante) que falla cerrado y responde igual exista o no la cuenta; preferencia en Ajustes. Probado con el adaptador simulado: no se mandó nada.

**R32-10 · Calidad.** e2e de la tanda corridos en local (ver Verificación). Un e2e (390) encontró un **bug real** en el guardado de la carrera pedida (arrays de JS interpolados en una consulta: el guardado nunca escribía y el recuadro no se iba); se diagnosticó después de dos vueltas, se arregló y quedó cubierto con un test que verifica el SQL generado.

## Decisiones

- **Carrera del alta = puestos más «Otra»**, sin un campo nuevo; «Otra» solo existe en el onboarding (la lista de espera pública y su check de `waitlist.role` no la aceptan).
- **Lista vacía = nada se cierra a quien ya está adentro.** El alta con invitación no se frena por la lista (una invitación es una decisión explícita del responsable).
- **«Para quien empieza» cuenta solo entre las tomables** y el semáforo es verde con 30 y 10, amarillo con la mitad o más de ambos, rojo en el resto. Solo informa.
- **Alertas por portal, no por alerta:** la app no puede saber de qué alerta de un mismo portal salió un email.
- **Sueldo original con moneda obligatoria:** un «$» solo no dice la moneda y no se supone; un monto sin moneda se descarta. Nada se convierte.
- **ReliefWeb con valor propio de enum** (migración 0090) para no compartir historial e intervalo con Jooble y Careerjet, que comparten `other`.
- **Migraciones:** 0089 (carreras, preferencia y datos del email de novedades) y 0090 (sueldo original y `reliefweb`), con la RLS 0074. Sin RLS nueva para la 0090.
- **El valor inicial de `news_email` es `true`** para todas las cuentas: decisión del responsable antes de aplicar la 0089 (`docs/beta/pasos-manuales-r32.md` §3).

## Lo no cumplido o con reservas

- **Nada se probó contra un servicio real.** Los formatos de Jooble y ReliefWeb (incluida la forma del filtro por país), los pasos de cada portal y los emails de Computrabajo salen de documentación pública o de fixtures inventadas; todo marcado «a verificar».
- **Las empresas regionales están sin verificar** y se espera que sirvan unas pocas; los ATS del pool solo guardan avisos remotos, así que esa vía rinde poco para «tomables en Argentina». Ampliarlo a avisos con lugar de trabajo en Argentina es un ADR aparte (R33).
- **`public_jobs` no tiene columna de país del lugar de trabajo:** «tomable» por lugar se lee del texto de la ubicación (`location_raw`), que nombra Argentina como país.
- **«Te avisamos por email apenas abra» no tiene un envío automático:** al abrir una carrera, el responsable avisa a la lista de espera (pasos manuales §8).
- **Las ofertas ya asignadas a una persona antes de la 0090 no tienen sueldo original:** la copia por persona no se reescribe; no se rellena nada a mano. Ninguna fuente da hoy un original no-USD junto con dólares, así que la equivalencia no aparece hasta que exista el dato.
- **Hallazgos abiertos de la revisión de `alta` (hecha por `cobertura`):** M1 (cuenta con claves de carrera viejas), L1 (la persona puede escribir `career_asked_at` y `news_email_sent_at` de su fila), L2 (`news_email_unsubscribe` baja a cualquier uuid; protege la firma de la app), L3 («Otra» solo se frena en código) y L4 (un fallo de reasignación se traga sin log). Estado: **M1, L1, L2, L3 y L4 arreglados** (L1 con un trigger en la RLS 0074 y funciones para el recuadro; L2 con token firmado y respuesta sin oráculo; L3 en la función de la base; L4 con log). Quedan como decisión del responsable: M2 (`news_email` arranca en `true`) y M3 (el aviso «apenas abra» se da a mano desde la lista de espera).
- **Textos sin cotejar con el informe de revisión** (no se puede leer el PDF): siguen marcados `PENDIENTE-INFORME`. Los textos nuevos de la tanda viven en `ALTA_TEXTOS`, `FUENTES_TEXTOS` y `COBERTURA_TEXTOS` y entran a la lista de textos por aprobar.
- **Himalayas** (apagada por sus términos) y los lectores de Indeed, LinkedIn, Bumeran y Computrabajo no guardan sueldo original: no traen moneda.

## Verificación

- **Typecheck** 6 de 6, **lint** 0 errores. **Unit:** pipeline 7199, web 670, db 198, adapters 1806 (más las 3 fallas conocidas de enlaces simbólicos de Windows en `privacy-scan.test.ts`). Privacy-scan sin hallazgos en los commits de la tanda.
- **Integración (Testcontainers):** `apertura-carreras` (15 casos con el trigger y las funciones), email de novedades (7), cobertura (4) y `upsert`/`fetch` del pool (29 + verdes).
- **e2e en local, todos verdes:** 390 a 398 (alta, apertura, pocas ofertas, guía, baja del email, sueldo original), 404 a 407 (cobertura), 106, y como regresión 349, 358, 370, 376 y 383. Los de admin (393, 404 a 407, 376) se corrieron con la cuenta A como admin solo en local, para simular el CI. 406 cubre 390 y 360 px y teclado; 397 mide el botón de baja a 360 px. Notas: la persona A es admin en el CI y no en local, por lo que 393, 404 a 407 (salvo el primer test del 407) se saltean en local; el 395 depende de que la base local tenga menos de 5 ofertas de Relaciones públicas en 7 días.
- **Costo:** USD 0.
