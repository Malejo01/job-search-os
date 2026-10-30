# ADR-024: Pool de la beta cerrada desde alertas por email de Computrabajo (excepción acotada)

**Status:** Proposed · **Date:** 2026-10-26

## Context
- La beta cerrada necesita ofertas locales en español de carreras no tech (contabilidad, RRHH,
  marketing, derecho…). Las fuentes del pool con API o feed (ADR-014, ADR-018) casi no las tienen.
- Computrabajo ofrece un acuerdo de feed para agregadores, pero el trámite lleva semanas o meses y
  pide los documentos legales vigentes.
- Las condiciones de uso de los portales limitan la reutilización de sus contenidos. Computrabajo da
  una licencia de uso personal y prohíbe reproducirlos públicamente y usar scripts. Bumeran prohíbe
  tener más de una cuenta por usuario y usar software para navegar o buscar. Indeed prohíbe copiar
  el sitio.
- Computrabajo permite crear una alerta solo con un email (doble opt-in) y sin cuenta. ADR-018 §6 ya
  definía que los portales sin API entran solo por alertas por email. Esta ADR fija cómo entran al
  **pool** y con qué límites.

## Decision
Durante la **beta cerrada**, y hasta tener el acuerdo de agregador, el pool también se alimenta con
alertas por email de Computrabajo que suscribe Job Search, una casilla por carrera. Es una excepción
acotada, con estos límites:

1. **Solo Computrabajo.** Bumeran, ZonaJobs e Indeed no entran por este camino: piden cuenta y sus
   condiciones prohíben las cuentas múltiples o la copia.
2. **Casillas en el dominio de ingesta propio** (`pool-<carrera>@<dominio de ingesta>`). No se crean
   cuentas en ningún portal.
3. **Solo con sesión iniciada.** Las ofertas de esta fuente no aparecen en ninguna página pública:
   vitrina, `/ofertas`, `/mercado`, demo ni SEO.
4. **Atribución y link.** Cada oferta dice «vía Computrabajo», y postular lleva a la página original.
   La app nunca postula por la persona (ADR-004).
5. **Sin navegar el sitio.** Se usa solo lo que trae el email: título, empresa, ubicación, fragmento y
   link. La descripción completa la pega la persona («pendiente de JD»). No se baja la página de la
   oferta ni se sigue ningún link del email desde el servidor (D-028).
6. **Interruptor.** `POOL_SOURCE_COMPUTRABAJO_ALERTS` (apagado por defecto) habilita la fuente.
   Apagado, las casillas `pool-*` no procesan nada y las ofertas de la fuente no se muestran. Se apaga
   ante cualquier pedido del portal o al firmar el acuerdo.
7. **Volumen chico.** Unas pocas alertas por carrera (carrera × ciudad de la beta o remoto). Se revisa
   a los 60 días de prendida.
8. **Salida.** Con los documentos legales vigentes y la beta andando, se pide el feed de agregador, que
   reemplaza a esta fuente.
9. **Falla cerrado.** Sin un lector (parser) validado con emails reales, los emails de las casillas van
   a la cola manual del pool: nunca extracción parcial ni campos inventados. `countriesAllowed` queda
   `null` si el email no lo dice.

## Consequences
- Hace falta el lector de alertas de Computrabajo (ronda 48), probado con emails reales.
- El inbound tiene que reconocer las casillas `pool-*` como entrada del pool (`public_jobs`), no de
  una persona. También tiene que tratar a Computrabajo como remitente de empleo desde el primer
  email, para que el de verificación llegue con cuerpo (C-21a).
- Hace falta un valor nuevo en el enum de fuentes, con su migración.
- **Riesgo residual:** que el portal bloquee las alertas o haga un reclamo. Se mitiga con el
  interruptor, sin presencia pública y con la salida por el acuerdo. La decisión de correr ese riesgo
  es del responsable del producto.
- No es asesoramiento legal.
