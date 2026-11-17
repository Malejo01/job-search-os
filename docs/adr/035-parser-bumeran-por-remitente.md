# ADR-035: Ruteo por remitente del mail de Bumeran y su parser

**Status:** Proposed · **Date:** 2026-11-13

## Context
- Bumeran manda el mail «Bumeran te sugiere» desde la casilla de no responder del dominio `bumeran.com` (no `.com.ar`). Hoy cae en
  `generic`, que no está registrado: el email va a la cola manual y suma al contador «sin parser».
- Hay seis esqueletos de la R8-1 (`inbound:skeleton`, sin datos). Cinco son «Bumeran te sugiere»: una
  tarjeta por aviso con título, empresa, ubicación, contrato y modalidad. El sexto es la invitación
  de una empresa a postularse, con otra estructura.
- Los links de las tarjetas son un tracker por persona (`delivery.bumeran.com/…?id=…`) sin el id ni
  la URL del aviso.
- ADR-024 §1 dice que Bumeran «no entra por este camino» (el del pool). Eso no cambia acá.

## Decision
1. `chooseParserName` rutea a `bumeran` el dominio exacto `bumeran.com` o `bumeran.com.ar` y sus
   subdominios. No se usa `endsWith("bumeran.com")` (aceptaría `notbumeran.com`).
2. **ZonaJobs no se rutea.** No hay esqueletos de ese portal; no se supone que comparta estructura.
   Cuando haya uno con la misma estructura, se suma el dominio y su fixture.
3. Los dominios de Bumeran pasan a `EXPECTED_SOURCE_DOMAINS`: el mail se guarda completo (JS-051) y
   no avisa como fuga (JS-048). Sin eso el parser nunca vería el cuerpo.
4. El parser (`bumeran.ts`) falla cerrado y solo lee «Bumeran te sugiere». La invitación de una
   empresa, la bienvenida y cualquier otra estructura devuelven `{ ok: false }` y van a la cola manual.
5. **No guarda el link del mail.** Es un tracker con un id de la persona: `source.url` y `externalId`
   quedan null. Consecuencia: el mismo aviso en dos mails queda como «posible duplicado» (ADR-013),
   y la oferta no tiene enlace al original; la persona la busca en Bumeran por título y empresa.
6. Lo que el mail no dice queda null, `countriesAllowed` incluido, para que el prefiltro marque el
   riesgo de ubicación.
7. Este ADR no toca el pool ni ADR-024. Abrir el pool a Bumeran es otra decisión (ver R11-5), y la
   falta de URL del aviso es un obstáculo: el pool exige «link al original» (ADR-024 §4).

## Consequences
- Los mails de Bumeran con avisos entran por la casilla de la persona; los demás siguen en cola manual.
- Si Bumeran cambia la plantilla, el parser falla cerrado y el mail queda en cola manual.
- Los ejemplos del test son inventados y escritos a mano a partir de la estructura del esqueleto.
