# QA contaduría

Persona: Agustina Ficticia (`agustina`). Capturas: `agustina-<pantalla>-390|1280.png`.

- /acceso: el chip «Contaduría» guarda `finanzas_contabilidad`. ok.
- Registro y paso 1. ok.
- «Tus skills»: muestra 6 skills del puesto (contabilidad, reporting, software contable, impuestos, payroll, client-facing) y faltan Excel, Power BI, Tableau y SQL, que sí están en `role_skills.json`. El spec falló en `skill-excel`. La cuarta corrida volvió a fallar en `skill-excel`. **No concluyente en local (base sin seed); lo verifica el CI del PR** (los e2e 97 y 98 pasan sobre main con seed).
- Ofertas, /hoy, /jobs, detalle, Perfil, CV y ayuda: sin verificar en local.
- Prefiltro sobre el golden sintético: verde.
