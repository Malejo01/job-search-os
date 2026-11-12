# QA administración

Persona: Bruno Ficticio (`bruno`). Capturas: `bruno-<pantalla>-390|1280.png`.

- /acceso: el chip «Administración» guarda `administracion_empresas`. ok.
- Registro y paso 1. ok.
- «Tus skills»: el spec falló esperando `skill-excel` (y otras). La cuarta corrida volvió a fallar en `skill-excel`. **No concluyente en local (base sin seed); lo verifica el CI del PR** (los e2e 97 y 98 pasan sobre main con seed).
- Ofertas, /hoy, /jobs, detalle, Perfil, CV y ayuda: sin verificar en local.
- Prefiltro sobre el golden sintético: verde.
