# ADR-033: Relaciones públicas es una carrera propia y la beta tiene 8 carreras

**Status:** Accepted · **Date:** 2026-11-12 · Ticket C3 (tanda R5). Modifica el ADR-027 (carreras de la beta): `marketing_digital` deja de cubrir relaciones públicas. No reabre ADR-024 (pool) ni ADR-029 (visibilidad por umbral).

## Context

- El ADR-027 armó la beta con 6 carreras y metió relaciones públicas dentro de `marketing_digital` («Marketing y relaciones públicas»): títulos, chips de especialidad, skills y cargos propios del prefiltro.
- El 10/11 (C1, #454) la portada, `/acceso`, `/ayuda` y `/como-esta-hecho` pasaron a **8 carreras**: abogacía, contaduría, administración, comunicación, marketing, relaciones públicas, relaciones internacionales y programación. Hasta C3 el chip «Relaciones públicas» guardaba `marketing_digital` y «Programación» guardaba `fullstack`, porque la clave nueva era pipeline y carril rojo.
- Una persona de RR.PP. no busca lo mismo que una de marketing digital (SEO, pauta, performance): con una sola clave, o recibía avisos que no eran suyos o perdía los suyos.

## Decision

1. **Clave nueva `relaciones_publicas`**, al final de `ROLE_KEYS`. Rótulo «Relaciones públicas»; 11 skills de la taxonomía existente (`role_skills.json`), sin crear skills nuevas.
2. **Qué se mueve desde marketing:** los títulos de RR.PP. (`relaciones públicas`, `RRPP`/`RR.PP.`, relacionista, `PR specialist/executive/manager`), `public affairs`, `relaciones institucionales`, eventos (`organizador de eventos`, `events coordinator`) y RSE. Marketing conserva marca, trade, investigación de mercado, CRM, medios, contenidos y performance. La exclusión de RR.PP. de boliche, fiesta o promotor (`entradas`, `comisión`) pasa a la clave nueva.
3. **Chips de especialidad:** los cuatro de prensa, eventos, relaciones institucionales y RSE pasan a `relaciones_publicas` (el chip de prensa se llama «Relaciones públicas y prensa»). Marketing queda con 7. Se mantiene el invariante: la unión de los términos de los chips es `TITLE_TERMS[role]`.
4. **Prefiltro:** `pr manager` y `public relations manager` son cargos propios de `relaciones_publicas` (liberan «manager» de la blocklist, nada más). `communications manager` lo conservan marketing, comunicación y la nueva.
5. **Pool:** `pool-relaciones_publicas@` es una casilla válida (las casillas salen de `ROLE_KEYS`) y la carrera veta los títulos de ventas igual que marketing (`title-fit`).
6. **Beta:** `BETA_LAUNCH_ROLE_KEYS` pasa a 8, en el orden del anuncio: abogacía, contaduría, administración, comunicación, marketing, relaciones públicas, relaciones internacionales y programación (`fullstack`, que ya existía y ya tenía casilla `pool-fullstack`). `BETA_ROLE_KEYS` suma `relaciones_publicas`: queda sin listar en los selectores generales y pública solo al llegar al umbral de ofertas (ADR-029), pero `/acceso` y el onboarding la ofrecen siempre. `fullstack` no entra a `BETA_ROLE_KEYS`: es una carrera de tecnología ya listada.
7. **`/acceso`:** el chip «Relaciones públicas» guarda `relaciones_publicas`; el chip «Programación» sigue guardando `fullstack`. El grupo «Carreras de la beta» del selector muestra las 8.
8. **Rótulo de marketing:** pasa de «Marketing y relaciones públicas» a «Marketing digital». Es el texto que ve la persona y el que recibe el evaluador como puesto objetivo.
9. **Base de datos:** `waitlist_role_check` y la lista de `admin_founder_counts()` (`rls/0012`) suman `relaciones_publicas`. Es una migración de esquema (CHECK) y no necesita backfill: ninguna clave existente se renombra.

## Consequences

- Una persona que ya tenía `marketing_digital` y chips de prensa, eventos, relaciones institucionales o RSE los pierde (los ids no existen más en esa carrera y se ignoran). No hay perfiles reales con esos chips antes de la beta; si apareciera uno, elige RR.PP. de nuevo.
- Los avisos de RR.PP. ya guardados en el pool conservan el hint `marketing_digital` hasta correr `pool:rehint`. Después de aplicar la migración hay que correrlo para que el pool los reparta a la carrera nueva.
- Quien quiere las dos carreras las elige las dos (el perfil admite varias). Los títulos compartidos con relaciones internacionales (`relaciones institucionales`, `public affairs`) suman hint en las dos, sin vetarse, como antes.
- Los fixtures de `qa` y el golden de evals que etiquetan RR.PP. como marketing (`marketing_digital-04`, id 13 de `golden-carreras-beta`) no se tocan en este ticket: los tests los leen como `relaciones_publicas` con un mapa explícito hasta que se muevan.
- La taxonomía de skills (`skills.json`) no cambia: RR.PP. comparte skills con comunicación (`press_relations`, `corporate_communications`, `public_opinion`). Si hacen falta skills propias (gestión de crisis, vocería, protocolo), es un ticket aparte con migración de datos.
