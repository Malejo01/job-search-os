# Textos para tester A (C8-18)

Todo lo que tester A tiene que leer antes del 26/11, en un lugar. **En la app:** [`/settings/textos`](/settings/textos) (pedile a Admin que la abra con su cuenta de admin, o capturas): cada texto con su extracto, el archivo donde vive y un link a la pantalla. La lista sale de `packages/pipeline/src/textos-ani.ts`; un test avisa si un extracto deja de existir.

**Cómo pedir un cambio:** anotá el nombre del texto (como aparece en `/settings/textos`) y la frase nueva. Cada cambio es un PR chico en el archivo que dice la página. Los legales van aparte (`docs/legal/preguntas-ani.md`).

## Qué decidir en cada uno

| Dónde | Texto | Qué decidir |
| --- | --- | --- |
| Portada (`/`) | «Leemos cada oferta contra tu perfil y te decimos por qué sí y por qué no.» y «Menos postulaciones, mejor elegidas.» | ¿Suena a AfinIAJobs? ¿Se entiende para alguien de abogacía o contaduría? |
| `/acceso` | Introducción, confirmación («te escribimos si hay lugar»), «Qué sigue» y el texto de «Pasáselo a alguien» | Que quede claro que **el cupo es limitado** (decisión ya tomada); el tono del texto para compartir |
| `/precios` | «El link de pago llega con la invitación.» | Solo se ve con `PRICING_ENABLED=1`. ¿Se muestra el precio en la web o solo en la invitación? |
| `/ayuda` | Las preguntas frecuentes | Faltan las de las carreras no tech: ¿sirve para trabajos presenciales en Salta?, ¿qué pasa con mis datos?, ¿puedo cancelar? (reserva R-4) |
| Onboarding, paso 1 | **«Piso salarial mensual en USD (opcional)»** (R-2 de C7) | En Salta el sueldo de estas carreras es en pesos. ¿Lo dejamos, lo escondemos para estas carreras o pasamos a pesos (cambio grande, ronda aparte)? |
| Onboarding, paso 2, menú y Ajustes | **«Skills»** («Tus skills», «Mis skills») (R-2 de C7) | ¿«Conocimientos», «Habilidades» o queda «skills»? Es un PR propio porque toca muchas pantallas |
| Onboarding, paso 3 | **«Sumá tus alertas de LinkedIn, Get on Board e Indeed»** (R-2 de C7) | Get on Board es de tecnología. ¿Lo sacamos del título para estas carreras? (Computrabajo entra por otro camino, ADR-024) |
| Onboarding, paso 1 | Ejemplos de resumen (R-2 de C7) | Faltan ejemplos de contaduría y de relaciones internacionales |
| Onboarding, paso 1 | «Horas máximas por semana», «Autorización de trabajo», «Otros países donde puedo trabajar» (R-2 de C7) | ¿Los plegamos como «Avanzado» para la beta local? |
| Estados vacíos | «Todavía no tenés ofertas» | ¿Qué conviene decir el primer día, cuando el pool todavía no trajo nada de su carrera? |
| `/hoy` | «Empezá acá» (C8-5): «Pegá una oferta o esperá las nuestras» y los otros pasos | ¿Los cuatro pasos y su orden son los correctos para alguien nuevo? |
| «¿Qué es esto?» (C8-6) | Las 5 explicaciones (puntaje, A tu favor / Te falta, Sin descripción, CV, áreas) | La del puntaje da umbrales («un 8 o más suele valer la pena»): ¿los dejamos? Los textos se editan en un solo archivo |
| Emails | Bienvenida al activar el plan (C8-7) y aviso de vencimiento | Tono, y si la bienvenida tiene que nombrar el precio (hoy no lo hace) |
| Invitación | Mensaje con precio, 30 días y link de pago (C7-12) | El texto del pago y el de becados: los armó la nube, falta el OK de tester A |

## Revisión de textos de la R24 (R24-05, 23/11)

Lo que era código ya está arreglado (puntajes con coma, «score» → «puntaje» en Postulaciones; ver `ops/rondas/r24-tanda/R24-05/informe.md`). Lo que sigue es decisión de tester A. La columna «Captura» la completa qa con el archivo de `ops/capturas/r24/`.

| Pantalla | Archivo:línea | Texto actual | Propuesta | Por qué | Captura |
| --- | --- | --- | --- | --- | --- |
| Postulaciones, «Cómo viene la calibración» | `apps/web/app/(app)/applications/page.tsx:367-375` | «Modelo vs tu puntaje en la UI: MAE 0,42 sobre 8 evaluaciones, sesgo +0,10 (positivo = el modelo puntúa de más)» y «…comparar modelo vs humano fuera del golden» | «Tu puntaje y el de la IA difieren, en promedio, 0,4 puntos (la IA puntúa de más si el signo es +).» y sacar «golden» | «MAE», «sesgo», «UI» y «golden» son jerga interna; el resto de la pantalla habla en llano | `17-tracker` (la tarjeta de calibración aparece con más evaluaciones con puntaje propio) |
| Academy, ficha «Primer empleo sin experiencia» | `apps/web/content/academy/primer-empleo-sin-experiencia.md:19` | «Sé paciente con el proceso» | «Tené paciencia con el proceso» | «Sé paciente» es el imperativo de tuteo; el resto de la ficha usa voseo («Aprendé», «pedí») | `31-academy-ficha-borrador` (es el 404: las fichas están en borrador y no se ven) |
| `/mercado` (metadata y buscadores) | `apps/web/app/(public)/mercado/page.tsx:16` | «…y datos curiosos del pool.» | «…y datos curiosos de las ofertas que juntamos.» | «Pool» es inglés suelto en un texto que se ve en Google | — (página pública, fuera de la galería) |
| Cómo está hecho | `apps/web/app/(public)/como-esta-hecho/page.tsx:33` y `:58` | «Cada cambio de prompt se mide contra él…» y «Next.js (App Router), TypeScript estricto…» | Dejar como está (la página es técnica a propósito) o agregar una línea en llano arriba | Es la única página pública con términos de programación; decidir si el público es técnico | — (página pública, fuera de la galería) |
| Menú y títulos | `apps/web/app/(app)/sections.ts:10` y `apps/web/app/(app)/jobs/page.tsx:43` | «Match» | «Ofertas» o «Mis ofertas» (o dejar «Match» como nombre de marca) | Es el único rótulo de navegación en inglés; lo usan e2e 47 y 113 (hay que actualizarlos si cambia) | `11-match` y `11-match-viewport` (las pestañas de abajo solo se ven en la de viewport a 390) |
| Interview, inicio | `apps/web/app/(app)/interview/page.tsx:31` | «Practicá una entrevista: son 5 preguntas y, por cada respuesta, te mostramos qué tan…» | Mismo texto, movido a `textos-interview.ts` | Texto de pantalla escrito dentro del componente; Ani lo tiene que poder editar en un solo lugar | `07-interview-inicio` |
| Interview, informe | `apps/web/app/(app)/interview/[id]/report.tsx:96` | «Tu mejor respuesta y la que más puede mejorar» | Mismo texto, movido a `textos-interview.ts` | Ídem | `24-interview-informe` |
| Interview, progreso | `apps/web/app/(app)/interview/progress-table.tsx:43` y `:54` | «Con una simulación más vas a ver cómo cambian tus puntajes.» y «Promedio de cada criterio en tus simulaciones terminadas…» | Mismos textos, movidos a `textos-interview.ts` | Ídem (no se movieron: no es trivial y otro ticket de la tanda toca Interview) | `25-interview-historial-con-datos` (con una sola simulación terminada) |
| Armá tu CV con IA | `apps/web/app/(app)/cv/armar/chat.tsx:192-195` | «…armo un CV legible por ATS… No te asegura pasar ningún filtro: es un CV claro y fiel a lo que contás.» | Revisar el tono: la aclaración es correcta y no promete nada | Es el único lugar de la app que nombra «ATS» en un texto visible fuera de Academy y del glosario | — (el chat está apagado en la galería) |

## Lo que ya está decidido (no hace falta volver a mirarlo)

- La marca es **AfinIAJobs** (logo, colores y tipografías en `/settings/marca`).
- La beta abre el **jueves 26/11**, con 8 carreras y cupo limitado; la gente se anota en `/acceso`.
- El precio (ARS 20.000 por mes) va en la invitación, con el link de Mercado Pago.

## Decisiones del 5/11 que tocan los textos

Detalle y puntos abiertos en `docs/beta/runbook-apertura.md`, «Decisiones del 5/11».

- El cupo es de 15 a 20 personas. Solo dos personas no pagan; el resto paga uno de dos combos que arma tester A: [A DEFINIR: combos de tester A]. Hasta que estén, el precio de la invitación y de `/ayuda` puede cambiar.
- Becas: un becado gratis y dos con 50 % de descuento (ya no «3 becados»). El texto de becados de la invitación tiene que decir eso cuando Admin confirme quiénes son: [A CONFIRMAR con Admin].
- El 11/11 es el evento «Voces Jóvenes», no una charla.
- Soporte de la beta: WhatsApp Business (lo crea y etiqueta tester A) y `contacto@afiniajobs.com.ar` (la crea Admin, la atiende tester A).
- Los cobros van por una cuenta nueva de Mercado Pago compartida (hay que actualizar los links `MP_LINK_*`).
