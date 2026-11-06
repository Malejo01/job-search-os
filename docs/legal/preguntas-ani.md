# Legales: preguntas para Ani y dónde va cada respuesta (C8-12)

Las respuestas de Ani llegan **hasta el 13/11**. Este archivo junta lo que hay que preguntarle, dónde va cada respuesta y un ejemplo de redacción. **No es asesoramiento legal** y no cambia ningún texto: los textos vigentes son `apps/web/content/legal/terminos.md` y `privacidad.md` (carril rojo).

## Cómo se completan los datos

Los marcadores `[RESPONSABLE]`, `[DOMICILIO]` y `[EMAIL DE CONTACTO]` **no se escriben en el texto**: la app los reemplaza al mostrar la página con variables de Vercel (`packages/pipeline/src/legal/fill.ts`). Mientras falte alguna, la página dice «(dato en revisión)» y se muestra como borrador.

| Marcador | Variable de Vercel | Dónde aparece |
| --- | --- | --- |
| `[RESPONSABLE]` | `LEGAL_RESPONSABLE` | `privacidad.md:9`, `terminos.md:11`, `terminos.md:50` (y el encabezado de `docs/legal/datos-por-proveedor.md:3`, que es un doc interno) |
| `[DOMICILIO]` | `LEGAL_DOMICILIO` | `privacidad.md:9`, `terminos.md:11` |
| `[EMAIL DE CONTACTO]` | `LEGAL_EMAIL` | `privacidad.md:9`, `privacidad.md:22`, `privacidad.md:100`, `terminos.md:11`, `terminos.md:66` |
| `[A DEFINIR: plazo de retención de los logs]` | `LEGAL_LOG_DAYS` (número de días, 1 a 3650) | `privacidad.md:75` |
| `[A DEFINIR con Ani]` | — (hay que **reescribir el texto**, no es una variable) | `terminos.md:42` |
| `[REVISAR CON CAMILA (abogada): protección de marca / derecho de autor]` | — (lo resuelve Camila y se **reescribe el texto**) | `terminos.md:72`, `privacidad.md:141` (sección «Derechos reservados», aviso «© 2026 AfinIAJobs. Todos los derechos reservados.») |

**Para revisar qué falta:** `pnpm legal:check` lista cada marcador sin valor (con archivo y línea) usando las variables del entorno. Con `LEGAL_FINAL=1` falla si queda alguno: así se corre antes de dar los textos por finales.

## Preguntas

### 1. Responsable del tratamiento (`LEGAL_RESPONSABLE`)

- **Pregunta:** ¿quién figura como responsable: Mauro como persona humana o una sociedad? ¿Con qué nombre exacto y, si corresponde, CUIT?
- **Dónde va:** variable `LEGAL_RESPONSABLE`. Aparece en `privacidad.md:9` («El responsable del tratamiento de tus datos es **[RESPONSABLE]**»), `terminos.md:11` («La ofrece **[RESPONSABLE]** ("nosotros")») y `terminos.md:50`.
- **Ejemplo de redacción (solo el valor):** `Nombre y Apellido (CUIT 20-XXXXXXXX-X)` o `Nombre de la Sociedad S.A.S. (CUIT 30-XXXXXXXX-X)`.

### 2. Domicilio (`LEGAL_DOMICILIO`)

- **Pregunta:** ¿qué domicilio va: el real, uno constituido a efectos legales o el fiscal? ¿Hace falta el código postal?
- **Dónde va:** variable `LEGAL_DOMICILIO`. Aparece en `privacidad.md:9` y `terminos.md:11`.
- **Ejemplo:** `Calle Ejemplo 123, Salta Capital (A4400), Salta, Argentina`.

### 3. Email de contacto (`LEGAL_EMAIL`)

- **Pregunta:** ¿qué casilla atiende los pedidos de datos (acceso, rectificación, borrado) y las consultas? ¿Es la misma que `CONTACT_EMAIL` de la app?
- **Dónde va:** variable `LEGAL_EMAIL`. Aparece en `privacidad.md:9`, `:22` (borrar el pedido de acceso), `:100` (cómo borrar la cuenta) y `terminos.md:11` y `:66` (contacto).
- **Ejemplo:** `privacidad@afiniajobs.com.ar` (tiene que existir y leerse: los plazos de la ley 25.326 corren desde que llega).

### 4. Plazo de retención de los registros técnicos (`LEGAL_LOG_DAYS`)

- **Pregunta:** ¿cuántos días se conservan los registros técnicos (cola de trabajo terminada, contadores de rechazos)? El registro de llamadas a IA se conserva como mínimo 90 días porque es el registro de gastos.
- **Dónde va:** variable `LEGAL_LOG_DAYS`, en `privacidad.md:75`. Con la variable cargada, la purga diaria borra lo más viejo que eso.
- **Ejemplo:** `180` (el texto queda «se conservan por 180 días»).

### 5. Precio, reembolsos y forma de cobro (`terminos.md:42`) — **importante**

- **Hallazgo:** `terminos.md:42` (sección 6) dice «**La beta es gratuita.** Si en algún momento el servicio pasa a ser pago, te avisamos antes…» y termina en «Precio, reembolsos y forma de cobro: [A DEFINIR con Ani]». Pero la beta del 26/11 **es paga** (Plan Beta, ARS 20.000 por mes, activación manual, link de Mercado Pago en la invitación). El texto vigente no coincide con lo que se cobra.
- **Preguntas:**
  - ¿Cómo se describe el Plan Beta (precio en pesos, 30 días, activación manual, sin renovación automática)?
  - ¿Qué pasa si alguien paga y no le sirve: hay reembolso? ¿En qué plazo?
  - ¿Aplica el derecho de arrepentimiento de la compra a distancia (10 días) y hace falta un «botón de arrepentimiento» visible en la web?
  - ¿Hace falta emitir factura? (Hoy la invitación dice «sin factura».)
  - ¿Los becados aceptan los mismos términos?
- **Dónde va:** reescribir el párrafo de `terminos.md:42` (carril rojo, sube `TERMS_VERSION` en `apps/web/lib/terms.ts` y todas las cuentas vuelven a aceptar).
- **Ejemplo de redacción:** «Durante la beta hay dos planes: el gratis, con los topes de arriba, y el **Plan Beta**, de ARS 20.000 por 30 días, que se paga por Mercado Pago con el link de la invitación y se activa a mano. No se renueva solo: antes de que venza te avisamos por email. Si pagaste y en los primeros 10 días querés arrepentirte, escribinos a [EMAIL DE CONTACTO] y te devolvemos el pago completo.»

### 6. Transferencia internacional y proveedores de IA (`privacidad.md:49` a `:65`)

- **Pregunta:** ¿alcanza con el consentimiento expreso al aceptar la política para la transferencia a Estados Unidos (Google, Anthropic, Resend, Vercel, Neon)? ¿Hace falta algo más (cláusulas modelo, mención de la AAIP)?
- **Dónde va:** `privacidad.md:63`. El inventario de qué dato va a cada proveedor está en `docs/legal/datos-por-proveedor.md` (actualizado en C8-12).

### 7. Registro de la base de datos ante la AAIP

- **Pregunta:** ¿hay que inscribir la base de datos (usuarios y lista de espera) en el Registro Nacional de Bases de Datos antes de abrir la beta paga?
- **Dónde va:** no cambia texto; es un trámite. Si se inscribe, se puede sumar el número en `privacidad.md:131` (Autoridad de control).

### 8. Lista de espera del 11/11

- **Pregunta:** ¿cuánto tiempo se guardan los datos de quien se anotó y no entró? (Hoy quedan hasta que se borren a pedido; la IP se guarda solo como huella y se borra a las 24 h.)
- **Dónde va:** `privacidad.md:22` («Pedido de acceso») y la sección 6 (cuánto tiempo los conservamos).
- **Ejemplo:** «Si no entrás a la beta, borramos tu pedido de acceso a los 6 meses.»

### 9. Edad mínima (`terminos.md:32`)

- **Pregunta:** el texto pide 18 años o más. En Voces Jóvenes puede haber menores de 18: ¿se mantiene? ¿Cómo se lo dice en `/acceso`?
- **Dónde va:** `terminos.md:32` y `privacidad.md:121` (Menores).

## Después del 13/11

1. Mauro carga `LEGAL_RESPONSABLE`, `LEGAL_DOMICILIO`, `LEGAL_EMAIL` y `LEGAL_LOG_DAYS` en Vercel (producción) y hace redeploy.
2. PR rojo con el párrafo de precio (pregunta 5) y lo demás que cambie, subiendo `TERMS_VERSION`.
3. `LEGAL_FINAL=1 pnpm legal:check` con las variables cargadas tiene que pasar.
