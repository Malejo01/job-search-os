# Decisiones de diseño de la tanda C9 (rediseño completo)

Cerradas por Mauro el 3/11. No se reabren en un PR: un cambio va en un ADR o en una tanda nueva. Copiadas tal cual del pedido de la tanda.

**Objetivo.** Hoy la app «se nota hecha con IA»: tarjetas iguales, sin personalidad, textos genéricos, espaciado y jerarquía flojos. El rediseño le da una identidad propia: amable e ilustrada como Duolingo o Headspace, precisa como Linear o Vercel. Hay UN elemento memorable, el SELLO de afinidad, y todo lo demás lo acompaña. Ante la duda, menos adorno.

## 1. Personalidad

Amable e ilustrada. Mucho aire, tarjetas muy redondeadas, una sola cosa memorable por pantalla.

## 2. Color

La paleta índigo y lima ya está en globals.css (#353). Se agrega:

- Fondo de la app en claro: lavanda #EEEDF9 (canvas). Las tarjetas son blancas, sin borde lateral marcado.
- En oscuro se quedan los tokens actuales (canvas #14123A, surface #24215A).
- La lima #C6F25B va SOLO en: el botón de acción principal, el sello «Muy afín» y la pestaña o píldora activa. Nunca como fondo de bloques grandes ni de secciones.
- Índigo equilibrado: la cabecera es índigo #1E1B4B y el resto de la pantalla es claro.
- Cada color nuevo va como token --jso-* en claro y en oscuro, documentado en docs/ux/tokens.md, con contraste AA verificado por axe.

## 3. Tipografía

Reemplazá Manrope y Sora en apps/web/app/fonts.ts con next/font/google:

- Bricolage Grotesque: títulos (700), el sello (800) y el logotipo.
- Figtree: texto (500 y 600) y botones (700 y 800).
- Para las imágenes OG (next/og), cargá los mismos archivos de @fontsource/bricolage-grotesque y @fontsource/figtree (npm; licencia OFL). En los emails, una pila con fallback a Arial, porque los clientes de correo no cargan fuentes.

## 4. Logo B2

«AfinIA» en Bricolage Grotesque 800 y «Jobs» en 500, con el punto de la marca. Aplicalo en logo.tsx, favicon e íconos (regenerá los PNG con Playwright como hizo C7), OG, emails y manifest.

## 5. Forma y profundidad (P1, plano con borde de abajo)

- Sin sombras.
- Todo lo que se toca tiene un borde inferior más grueso y al tocarlo baja 3 px (el borde se achica lo mismo, así no salta el layout).
- Borde inferior de 6 px SOLO en botones y tarjetas destacadas (la oferta principal de Hoy, el detalle). En las listas, 4 px. En chips y filtros, 4 px.
- El color del borde inferior es un tono más oscuro del fondo del elemento (lima → #8FB82E; blanco → línea fuerte), como tokens.
- Radios: contenedores 32 px, tarjetas 24 px, campos 18 px, botones, chips y filtros en píldora.
- El hundimiento es CSS (:active y una clase utilitaria tipo `pressable`), no Framer: así sirve en Server Components.

## 6. Cabecera y navegación

- Cabecera índigo curva y alta, con ilustración, SOLO en Hoy y en /acceso.
- En el resto de las pantallas, una barra índigo fina con el logo y las píldoras.
- En la computadora, el menú va arriba, en píldoras, dentro de la cabecera o la barra; la sección activa es una píldora lima.
- En el celular, N2: pestañas fijas abajo (Hoy, Ofertas, Postulaciones, Mi CV, Perfil), la activa en lima, respetando safe-area. C8 dejó una barra (R-3, #399) detrás de MOBILE_TABBAR_ENABLED con Hoy, Ofertas, Pendientes y Perfil: partí de esa, pasala a estas 5 pestañas y que quede prendida por defecto (sacá la variable o invertila; anotalo). En el celular el «Menú» se reemplaza por las pestañas: lo que no entra en las 5 va en Perfil, dentro de un «Más». Actualizá la guía (guided-tour) y anclá los e2e de 390 px al nav de las pestañas.

## 7. El SELLO de afinidad (reemplaza a ScoreBadge en toda la app)

- Un círculo con el número (Bricolage 800) y una palabra abajo, a la DERECHA de cada oferta.
- Niveles (lógica pura en packages/pipeline/src/score-display.ts, con tests; respeta los cortes de 7 y 5 que ya usa el código):
  - 8,5 a 10 → «Muy afín»: fondo lima, borde índigo, INCLINADO −8°. Es el ÚNICO inclinado.
  - 7 a 8,4 → «Bastante afín»: blanco, borde índigo, derecho.
  - 5 a 6,9 → «Afín a medias»: blanco, borde índigo, derecho.
  - 3 a 4,9 → «Poco afín»: blanco, borde gris, derecho.
  - menos de 3 → «Lejos de tu perfil»: blanco, borde gris, derecho.
- Estados que ya existen: «pendiente» → C2 (punto 10); «estimación» (puntaje previo por reglas) → sello con borde punteado, número y la palabra «Estimado»; «sin evaluar» → sello vacío punteado con «Sin evaluar».
- El significado nunca depende solo del color: la palabra siempre está. El aria-label conserva «puntaje 8.5».
- Tamaño: 60 px en listas y 78 px en el detalle. Revisá que «Lejos de tu perfil» entre en dos líneas sin achicar la letra por debajo de 10 px; si no entra, el sello de ese nivel puede ser una píldora en vez de un círculo (anotalo).
- En la lista de ofertas, las «Lejos de tu perfil» van SIEMPRE al final, debajo de un separador «Lejos de tu perfil (n)», sea cual sea el orden elegido.

## 8. Tarjeta de oferta K2 (offer-card.tsx y donde haya tarjetas de oferta)

- Puesto (Bricolage 700), empresa y lugar dichos en una frase («Estudio Ruiz y Asociados, en Salta» o «Grupo Norte, remoto en Argentina»), sin separadores «·».
- Chips: verdes con lo que tenés (ítems «cumple» del checklist), ámbar con lo que te falta («no_cumple»), como mucho 3 en total y «y 2 más». Los chips llevan ícono y texto, no solo color.
- Una línea de conteo: «4 a tu favor, 1 te falta».
- Modalidad y antigüedad del aviso en texto chico.
- El sello a la derecha.
- Si la evaluación no tiene checklist (ver C9-6), los chips salen de fortalezas y debilidades de la evaluación y no se muestra el conteo.

## 9. Detalle de oferta D3 (checklist para mejorar)

- Arriba, el sello grande y una frase de cercanía: «Cumplís 4 de 5 requisitos. Te falta uno para quedar entre las mejores candidatas.» (la cuenta sale de checklist.must y checklist.deseable).
- Cada requisito con su check (cumple), su cruz (no cumple) o su signo de pregunta (no se sabe), con ícono y texto.
- Lo que falta lleva una ayuda que es un paso concreto. Usá missingCta de requisitos-del-aviso.tsx: cargar el nivel de la skill, completar años, inglés o jornada en el perfil, o sumarla al CV si ya la tiene. «Cómo aprenderlo» NO se muestra (el plan de estudios todavía no existe).
- Es una reestructuración visual de «Requisitos del aviso»: no cambies cómo se calcula el estado de cada ítem.

## 10. Mientras se evalúa (C2)

La oferta se ve completa y, en el lugar del sello, gira despacio un sello vacío con «Leyendo la oferta contra tu perfil…». Con «reducir movimiento», queda quieto con el mismo texto.

## 11. Ofertas en la computadora (O3)

Lista a la izquierda y detalle D3 a la derecha, sin cambiar de página. La oferta elegida vive en la URL (?oferta=<id>) para que funcione el botón atrás y se pueda compartir el enlace; el detalle se renderiza en el servidor. En el celular, tocar una oferta sigue yendo a /jobs/[id].

## 12. Estados

- Sin ofertas todavía (V3): ilustración chica y un checklist de qué hacer mientras (perfil, áreas, CV) con una sola acción principal. Integrá el «Empezá acá» de C8 en vez de duplicarlo.
- Errores que cortan toda la pantalla (404, error.tsx, global-error.tsx, caída) (F1): pantalla con ilustración, una frase clara y una salida.
- Errores chicos (F2): aviso en el lugar, sin perder lo que la persona escribió.

## 13. Movimiento (M2)

- Responde al toque: botones, chips y tarjetas se hunden (CSS, punto 5).
- Dos momentos de marca, con Framer Motion en client components chicos:
  - a. El sello se estampa (entra grande y girado, rebota y queda) cuando la evaluación pasa de pendiente a lista con la pantalla abierta, y la primera vez que la persona ve esa oferta evaluada. El registro de «ya vista» va en localStorage con try/catch; si falla, no anima.
  - b. El check se tilda con un rebote chico al cumplir un paso de un checklist.
- Nada entra escalonado, nada flota, no hay animaciones en loop salvo el sello de C2.
- Con prefers-reduced-motion: nada se anima (ni el sello, ni el check, ni C2; el hundimiento puede quedar sin transición).
- Sacá las animaciones de entrada o decorativas que existan hoy.

## 14. Textos y tono

«Amigo con onda», profesional y con consejos de coach. Tres reglas:

1. La onda va solo en los momentos tranquilos (saludo, estados vacíos, logros). Con un error o un puntaje bajo, el tono es claro y sereno: nada de «Uh», «Tranqui» ni chistes.
2. Todo lo que falta se dice como un paso concreto: no «Te falta Tango», sino «Sumá Tango y esta oferta te queda mucho más cerca».
3. Guiños locales (el mate, «te queda pintada», «te calza») como mucho uno por pantalla.

Además: los botones dicen exactamente qué hacen («Ver mis ofertas», «Guardar descripción»), sin onda; se trata de «vos»; nunca se promete trabajo. Ejemplos de referencia:

- Saludo de Hoy: «¡Buen día, Lucía! Hoy hay 3 ofertas que te pueden quedar pintadas.»
- Por qué del puntaje: «Te queda muy bien por tus 3 años en sueldos. Sumá Tango Gestión y quedás entre las mejores candidatas.»
- Sin ofertas: «Todavía no llegó nada, pero estamos buscando todos los días. Mientras, dejá tu perfil a punto: elegí tus áreas.»
- Error al guardar: «No pudimos guardar la descripción. Tu texto sigue acá: revisá la conexión y tocá Guardar otra vez.»
- Botón: «Ver mis ofertas».
- Asunto de email: «Lucía, hay 3 ofertas que te calzan».

Los textos generados por el modelo (fortalezas, debilidades) no se reescriben: solo cambia cómo se presentan.

Cambios de texto ya decididos por Mauro (C9-15):

- /acceso: «El cupo es limitado: anotarte no garantiza un lugar.» pasa a ser «El cupo es limitado.»
- /ayuda: en las dos respuestas que dicen que anotarse no garantiza lugar, sacá esa parte y dejá «El cupo es limitado.»; el resto de la respuesta sigue igual. Actualizá el e2e 96-ayuda.spec.ts. El comentario de acceso/actions.ts puede quedar.

## 15. Ilustraciones

Personajes ilustrados que Mauro genera aparte con Gemini. Esta tanda NO genera imágenes: deja los lugares listos (C9-12). Siempre van dentro de un recuadro lavanda #EEEDF9 redondeado (32 px), igual en claro y en oscuro.

## Cómo se aplicaron (se completa al cierre)

Las decisiones de implementación que tomó la nube, con su alternativa, están en el PR de integración bajo «Decisiones para Mauro».
