# QA programación

Persona: Julián Ficticio (`julian`). Capturas: `julian-<pantalla>-390|1280.png`.

- /acceso: el chip «Programación» se elige y guarda `fullstack` (sin clave propia, decisión vigente). ok.
- Registro y paso 1. ok.
- «Tus skills»: el spec falló esperando `skill-typescript` (corridas 3 y 4). **No concluyente en local (base sin seed); lo verifica el CI del PR.**
- Ofertas, /hoy, /jobs, detalle, Perfil, CV y ayuda: sin verificar en local.
- Prefiltro sobre 6 avisos sintéticos (`fullstack.json`): verde, sin hallazgos.

## Hallazgo
- **P2 · ayuda:** la FAQ «¿Necesito conocimientos técnicos o saber de programación?» dice que la app es para ciencias sociales, económicas y jurídicas y «sin jerga técnica», y Programación es una de las 8 carreras. Archivo probable: `apps/web/app/(public)/ayuda/page.tsx`.

## Parte 2 (sobre C3+C8)

Spec 126 filtrado a programación sobre `ronda/r5-c8-catalogos` (local, no se pushea): 1 pasó, 1 falló y 4 no corrieron. Pasó /acceso con el chip. Falló «invitación, registro y onboarding» en `getByTestId('skill-typescript')`, igual que sobre main: **no concluyente en local (base sin seed); lo verifica el CI del PR.** El grupo del paso 1 de la persona es ahora «Carreras de la beta».

- /acceso sigue guardando `fullstack` (`apps/web/app/(public)/acceso/page.tsx`), decisión vigente (la casilla del pool es `pool-fullstack`).
- Prefiltro de los 6 avisos sintéticos (`fullstack.json`): verde también sobre C3+C8.
- Sin cambios en el P2 de la ayuda (sigue diciendo «sin jerga técnica» pese a que Programación es carrera de la beta).
