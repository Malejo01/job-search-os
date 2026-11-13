# QA abogacía

Persona: Mariana Ficticia (`mariana`). Capturas: `mariana-<pantalla>-390|1280.png`.

- /acceso: el chip «Abogacía» guarda `abogacia`. ok.
- Registro con invitación, paso 1 y «Tus skills» (10 skills del puesto, entre ellas contratos, derecho societario, laboral y litigio). ok.
- Ofertas evaluadas, /hoy, /jobs y detalle con puntaje. ok.
- Perfil, CV y ayuda. ok.
- Prefiltro sobre el golden sintético: verde.

Hallazgos propios: ninguno grave. Generales en el README.
P2: en «Tus skills» de Abogacía aparece «Negociación y cierre de ventas» como última skill del puesto; revisar si corresponde a la carrera (`packages/db/seeds/role_skills.json`, clave `abogacia`).
