# ADR-036: Pool desde alertas por email de Bumeran (propuesta, sin implementar)

**Status:** Proposed · **Date:** 2026-11-13 · **Amplía:** ADR-024 · **Depende de:** ADR-035

## Context
- ADR-024 abrió el pool a las alertas por email de Computrabajo, con casillas `pool-*` propias, y
  dejó afuera a Bumeran, ZonaJobs e Indeed (§1). Bumeran prohíbe tener más de una cuenta por persona
  y usar software para navegar o buscar.
- El dueño del proyecto decidió avanzar con cuentas propias del producto en Bumeran, una por carrera
  de la beta, para que lleguen alertas a las casillas `pool-*`. Esta ADR deja escrito qué haría falta,
  el riesgo y la mitigación. **No se implementa nada con esta ADR.**
- ADR-035 agregó el parser de «Bumeran te sugiere» para la casilla de una persona. Ese parser no
  guarda ningún link del mail: los de las tarjetas son un tracker por persona
  (`delivery.bumeran.com/…?id=…`), sin el ID ni la URL del aviso.

## Bloqueo: el pool exige el link al original y el mail de Bumeran no lo trae
ADR-024 §4: «cada oferta dice “vía Computrabajo” y postular lleva a la página original». Un aviso del
pool sin URL ni ID de la fuente:
1. No cumple §4: no hay a dónde llevar a la persona.
2. No se puede deduplicar contra el mismo aviso de otra fuente (ADR-013 pide URL, ID o JD).
3. No tiene `external_id`, que el pool usa como clave (`public_jobs.external_id` es obligatorio).

Guardar el tracker no es una salida. Lleva un identificador de quien recibió el mail (aquí, la cuenta
propia del producto) y, si el pool alguna vez se muestra, se estaría exponiendo ese identificador.
Seguirlo desde el servidor para resolver la URL real es navegar el sitio, lo que ADR-024 §5 y D-028
prohíben.

## Opciones
1. **No publicar Bumeran en el pool.** Sigue entrando solo por la casilla de cada persona (ADR-035).
   El pool no cambia y ADR-024 queda intacta.
2. **Link a la búsqueda del portal.** El aviso del pool lleva a una búsqueda de Bumeran por título y
   empresa. No es «la página original» de §4, hay que verificar que exista una URL de búsqueda estable
   y sin sesión, y puede llevar a otro aviso. Solo con aprobación expresa de Bumeran.
3. **Pedirle a Bumeran el dato.** Un acuerdo o un feed que traiga la URL o el ID del aviso, o la
   confirmación de que el link del mail se puede usar así. Es una gestión fuera del repo (Puerta 3).

## Recomendación
La opción **1 ahora**, y la **3 en paralelo** como pedido del dueño del proyecto. La 2 solo si Bumeran
la autoriza por escrito. Es lo más conservador: no se agrega ninguna fuente que incumpla §4, no se
suma riesgo con el portal y no se pierde nada, porque la persona ya recibe sus avisos por su casilla.

## Si se aprueba más adelante (condiciones, no implementación)
Con la opción 2 o 3 aprobada y la URL o el ID disponibles, las condiciones de ADR-024 se repiten para
Bumeran:
- Casillas `pool-*` en el dominio de ingesta propio, una por carrera, sin cuentas ajenas.
- Solo con sesión iniciada: nada de Bumeran en vitrina, `/ofertas`, `/mercado`, demo ni SEO.
- Cada oferta dice «vía Bumeran» y lleva al aviso original; la app nunca postula (ADR-004).
- Interruptor propio, apagado por defecto (`POOL_SOURCE_BUMERAN_ALERTS`), y se apaga ante cualquier
  pedido del portal.
- Volumen chico: pocas alertas por carrera, y revisión a los 60 días de prendida.
- Reusa el parser de ADR-035. No guarda datos de la persona a la que le llegó el mail.
- Falla cerrado: sin lector validado con mails reales, todo va a la cola manual del pool.

Pasos manuales, solo después de esa aprobación: crear las alertas por carrera en Bumeran con las
cuentas propias; crear los filtros de Gmail que las reenvían a cada casilla `pool-*`; prender el
interruptor en Vercel.

## Consequences
- Hoy no se agrega código ni variables. Bumeran queda como fuente personal.
- El riesgo residual de la opción 2 o 3 es que el portal bloquee las alertas o haga un reclamo. Se
  mitiga con el interruptor, la ausencia de presencia pública y la salida por acuerdo.
- No es asesoramiento legal.
