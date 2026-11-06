# Textos para Ani (C8-18)

Todo lo que Ani tiene que leer antes del 26/11, en un lugar. **En la app:** [`/settings/textos`](/settings/textos) (pedile a Mauro que la abra con su cuenta de admin, o capturas): cada texto con su extracto, el archivo donde vive y un link a la pantalla. La lista sale de `packages/pipeline/src/textos-ani.ts`; un test avisa si un extracto deja de existir.

**Cómo pedir un cambio:** anotá el nombre del texto (como aparece en `/settings/textos`) y la frase nueva. Cada cambio es un PR chico en el archivo que dice la página. Los legales van aparte (`docs/legal/preguntas-ani.md`).

## Qué decidir en cada uno

| Dónde | Texto | Qué decidir |
| --- | --- | --- |
| Portada (`/`) | «Leemos cada oferta contra tu perfil y te decimos por qué sí y por qué no.» y «Menos postulaciones, mejor elegidas.» | ¿Suena a AfinIAJobs? ¿Se entiende para alguien de abogacía o contaduría? |
| `/acceso` | Introducción, confirmación («te escribimos si hay lugar»), «Qué sigue» y el texto de «Pasáselo a alguien» | Que quede claro que **anotarse no asegura lugar** (decisión ya tomada); el tono del texto para compartir |
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
| Invitación | Mensaje con precio, 30 días y link de pago (C7-12) | El texto del pago y el de becados: los armó la nube, falta el OK de Ani |

## Lo que ya está decidido (no hace falta volver a mirarlo)

- La marca es **AfinIAJobs** (logo, colores y tipografías en `/settings/marca`).
- La beta abre el **jueves 26/11**, con 6 carreras y cupo limitado; anotarse en `/acceso` no garantiza lugar.
- El precio (ARS 20.000 por mes) va en la invitación, con el link de Mercado Pago.

## Decisiones del 5/11 que tocan los textos

Detalle y puntos abiertos en `docs/beta/runbook-apertura.md`, «Decisiones del 5/11».

- El cupo es de 15 a 20 personas. Solo Camila y Virginia no pagan; el resto paga uno de dos combos que arma Ani: [A DEFINIR: combos de Ani]. Hasta que estén, el precio de la invitación y de `/ayuda` puede cambiar.
- Becas: un becado gratis y dos con 50 % de descuento (ya no «3 becados»). El texto de becados de la invitación tiene que decir eso cuando Mauro confirme quiénes son: [A CONFIRMAR con Mauro].
- El 11/11 es el evento «Voces Jóvenes», no una charla.
- Soporte de la beta: WhatsApp Business (lo crea y etiqueta Ani) y `contacto@afiniajobs.com.ar` (la crea Mauro, la atiende Ani).
- Los cobros van por una cuenta nueva de Mercado Pago compartida (hay que actualizar los links `MP_LINK_*`).
