# Auditoría de primer uso · 13/11

Resumen público de un recorrido por producción con una cuenta de auditoría. La persona simulada es una contadora recién recibida del interior de Argentina, con inglés A2, que busca solo ofertas en español y remotas. El recorrido se hizo en escritorio (1267 px) y en celular (500 px). Los nombres de empresas van con alias.

- **Con sesión:** onboarding → guía de alertas → Ofertas y detalle → Hoy → Ajustes y áreas → Mi CV y chat de CV → Postulaciones → Perfil → Mercado → Plan.
- **Sin sesión, en celular:** portada → Pedir acceso → Ofertas de muestra → Entrar.

Los arreglos van en la Tanda R11, tickets R11-9 a R11-13 (más una suma a R11-7).

## Lo que anduvo bien
- La guía del onboarding es clara y el perfil se guarda completo.
- La primera evaluación llegó en unos 15 s, con un veredicto razonable y bien explicado.
- La dirección de reenvío, el plan y el chat de CV funcionan y responden rápido.
- En celular no hay desborde horizontal. La barra de abajo, Pedir acceso y Entrar son claros.

## P0 · Rompen la confianza o la propuesta de valor

| # | Hallazgo | Ticket |
|---|---|---|
| 1 | Las skills de los avisos están mal etiquetadas en todo el pool. En el Mercado de Contaduría, las más pedidas salen Growth/marketing (64 %), IAM (49 %), n8n (46 %) y modelos multimodales (33 %). El Plan le propone a una contadora 93 skills y unas 1827 h (Go, Kubernetes, Java, RAG, MCP). Un aviso público de «Renewals Manager» (Empresa A) sale con IAM y Propiedad intelectual. Una categoría amplia de una fuente («management-and-finance») mete en Contaduría avisos que no son contables. | R11-9 |
| 2 | La portada promete lo que el pool no tiene: el ejemplo es un puesto contable local con puntaje alto, y el número de ofertas activas es, en su mayoría, de tecnología y en inglés. La persona recibió una sola oferta, de otro país y con puntaje 3. | R11-10 |
| 3 | La guía de alertas recomienda primero Computrabajo, cuyas alertas todavía no se leen. | R11-10 |
| 4 | Casi no hay ofertas en español para las carreras de la beta: Contaduría tiene 8 de 211, y Abogacía, RR.PP. y RR.II. tienen 0. Lo destraban los lectores de alertas de portales locales. | R11-3, R11-4, R11-10 |

## P1

| # | Hallazgo | Ticket |
|---|---|---|
| 5 | El detalle se contradice: «Cumplís los 3 requisitos» con la barra llena, y abajo puntaje 3, «descartarla» y 5 excluyentes en «Te falta». En celular se ve primero lo positivo y el botón fijo «Postularme». | R11-11 |
| 6 | Valores internos a la vista: «Disponible en *», «Puesto de otra», slugs de carrera y disciplina, «(must)». | R11-11 |
| 7 | El CV copia el resumen del perfil, que está escrito para la IA y dice lo que la persona no sabe. | R11-12 |
| 8 | «Subir tu CV» en Hoy lleva a una pantalla sin forma de subirlo. | R11-12 (y R10) |
| 9 | El catálogo de Contaduría trae software contable de EE.UU. y no el de Argentina. «Client-facing» es una skill de tecnología. | R11-13 |
| 10 | Un mail personal de contacto aparece en Ajustes › Plan y en el aviso de privacidad de Pedir acceso. Va a una casilla de contacto. | ya anotado |
| 11 | El cierre del onboarding y la guía de alertas nombran portales distintos. | R11-10 |
| 12 | Hoy pide «Elegir tus áreas» justo después de elegir la carrera, aunque es opcional. | R11-13 |
| 13 | En celular, el botón flotante «¿Algo no anduvo?» tapa contenido en las pantallas con sesión. | R11-13 |
| 14 | En celular, la primera oferta de /jobs queda debajo del pliegue. | R11-13 |
| 15 | En «se ven, no frenan» aparece un riesgo que contradice un excluyente. | R11-11 |

## P2 (R11-13)
16. El paso 2 del onboarding abre al final de la página, y /jobs abre corrido.
17. En el paso de skills, «Guardar» y «Guardar y seguir» confunden.
18. El Mercado muestra dos bloques con totales distintos (211 y 191).
19. El chat de CV arranca en «2 de 7», pregunta el puesto que ya está en el perfil y no usa la pasantía del resumen.
20. Perfil abre con un menú «Más» arriba del formulario; en celular el formulario queda debajo del pliegue.
21. Un aviso de nómina «menciona Ciberseguridad».
22. El idioma de las ofertas viene en «En los dos» antes de cargar el nivel de inglés.
23. En el selector, de las carreras de la beta solo Contaduría tiene descripción, y Programación muestra un sueldo típico en USD bajo «LatAm».
24. Portada en celular: un hueco vacío de unos 150 px después de «Cómo funciona», y los 3 pasos son solo títulos.
25. Ofertas de muestra en celular: 26 botones de carrera antes del primer aviso, y las 8 de la beta se ven igual que el resto.

## Herramientas internas (R11-7)
- `admin:test-users --list` informa «onboarding completo» en cuentas que todavía están en el onboarding.
- `admin:test-users --create --remote` toma `ADMIN_EMAILS` e `INGEST_DOMAIN` del entorno local sin avisar.
- `inbound:skeleton` dejó sin enmascarar el nombre que sigue a un saludo cuando se repetía entre mails. La plantilla tiene que enmascarar siempre la palabra que sigue a «Hola», «Estimado/a», «Querido/a» o «Buen día».
