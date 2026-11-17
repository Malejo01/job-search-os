# ADR-037: Ruteo por remitente del mail de recomendaciones de Computrabajo y su parser

**Status:** Proposed · **Date:** 2026-11-13 · **Complementa:** ADR-035

## Context
- Un mail de Computrabajo que llega a la casilla de una persona hoy cae en `generic`, que no está
  registrado: va a la cola manual y suma al contador «sin parser».
- Hay cuatro esqueletos de la R8-1 (`inbound:skeleton`, sin datos), todos del dominio
  `computrabajo.com`. Solo uno es una lista de avisos («empleos recomendados»): cada tarjeta es un
  link que envuelve título, empresa y ubicación. Otros dos son un recordatorio («Volvé a revisar
  estos trabajos»), con los mismos datos pero botones en lugar de una tarjeta con link. El cuarto es
  un seguimiento de una empresa, sin tarjetas.
- A diferencia de Bumeran (ADR-035), el link de cada tarjeta es un tracker que lleva la URL pública
  del aviso en el parámetro `url=`, con un ID de 32 caracteres hexadecimales.
- ADR-024 define otro camino: las casillas `pool-*` del pool. No cambia.

## Decision
1. `parserForSenderDomain` rutea a `computrabajo` el dominio exacto `computrabajo.com` o sus
   subdominios. Los dominios de país (`.com.ar`…) no se rutean: ningún esqueleto los avala.
2. `computrabajo.com` pasa a `EXPECTED_SOURCE_DOMAINS` (el mail se guarda completo y no avisa como
   fuga); sin eso el parser nunca vería el cuerpo.
3. El parser (`computrabajo.ts`) falla cerrado y solo lee la tarjeta con link. El recordatorio, el
   seguimiento de una empresa y cualquier otra estructura devuelven `{ ok: false }` y van a la cola
   manual. El recordatorio se reconoce además por su texto, para dar un motivo claro.
4. De `url=` salen `externalId` (el ID) y `source.url` (`https://<país>.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-<slug>-<ID>`,
   sin parámetros). El host debe ser `<2 letras>.computrabajo.com`; si no, la tarjeta no es un aviso
   y el mail falla. El resto del tracker (`ipo`, `idu`, `isd`…) identifica a la persona y no se
   guarda. No se sigue ningún link desde el servidor.
5. Lo que el mail no dice queda null: `countriesAllowed`, modalidad, contrato, sueldo. «Hoy» o «Hace
   3 días» son relativos y no se convierten en fecha.

## Consequences
- Los avisos de las recomendaciones entran por la casilla de la persona, con ID y URL, así que el
  dedup los cruza por clave fuerte con el mismo aviso cargado por otro medio.
- Los recordatorios no se ingestan: son avisos que la persona ya vio.
- Si Computrabajo cambia la plantilla, el parser falla cerrado.
- Los ejemplos de los tests son inventados y escritos a mano a partir de la estructura del esqueleto.
