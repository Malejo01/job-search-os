# QA programación

Persona: Julián Ficticio (`julian`). Capturas: `julian-<pantalla>-390|1280.png`.

- /acceso: el chip «Programación» se elige y guarda `fullstack` (sin clave propia, decisión vigente). ok.
- Registro y paso 1. ok.
- «Tus skills»: el spec falló esperando `skill-typescript` (corridas 3 y 4). **No concluyente en local (base sin seed); lo verifica el CI del PR.**
- Ofertas, /hoy, /jobs, detalle, Perfil, CV y ayuda: sin verificar en local.
- Prefiltro sobre 6 avisos sintéticos (`fullstack.json`): verde, sin hallazgos.

## Hallazgo
- **P2 · ayuda:** la FAQ «¿Necesito conocimientos técnicos o saber de programación?» dice que la app es para ciencias sociales, económicas y jurídicas y «sin jerga técnica», y Programación es una de las 8 carreras. Archivo probable: `apps/web/app/(public)/ayuda/page.tsx`.

Repetir sobre la rama de C3 (parte 2).
