# QA marketing

Persona: Valentina Ficticia (`valentina`). Capturas: `valentina-<pantalla>-390|1280.png`.

- /acceso: el chip «Marketing» guarda `marketing_digital`. ok.
- Registro y paso 1. ok.
- «Tus skills»: el spec falló esperando `skill-seo` (corridas 3 y 4). **No concluyente en local (base sin seed); lo verifica el CI del PR.**
- Ofertas, /hoy, /jobs, detalle, Perfil, CV y ayuda: sin verificar en local.
- Prefiltro sobre el golden sintético: verde.

Nota: en el selector el puesto se llama «Marketing y relaciones públicas» (`role_skills.json`), mientras el chip de /acceso separa Marketing y Relaciones públicas. Lo ordena C3/C8.
