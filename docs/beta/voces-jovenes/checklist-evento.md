# Checklist del 11/11 — Voces Jóvenes

Para Ani y Mauro. Está escrito sin jerga: cada paso dice qué hacer y qué tendrías que ver. Lo que dice **(Mauro)** lo hace Mauro porque toca producción o la base. Los QR y qué hacer si algo falla están en [`README.md`](./README.md).

**Lo que ya está decidido y no se discute el día del evento:** la beta abre el jueves 26/11 para 6 carreras (abogacía, contaduría, administración, comunicación, marketing y RR.PP., relaciones internacionales). Cupo: 15 a 20 personas que pagan más 3 becadas. Plan Beta: ARS 20.000 por mes, sin garantía, sin factura. **Anotarse no asegura un lugar.**

---

## Antes (del 2 al 10/11)

### Los topes de la lista de espera (Mauro)
La página frena a quien se anota muchas veces para evitar abusos. Los límites actuales son:
- **40 anotaciones por hora desde el mismo wifi** (todos los celulares de una sala comparten una sola «dirección» de internet);
- **60 cada 10 minutos** entre todas las personas;
- **600 por día** entre todas.

Si alguien se pasa, ve: «Recibimos muchos pedidos desde tu conexión. Probá de nuevo en un rato.»

- [ ] **Ani:** estimá cuánta gente va a anotarse y cuántos lo harán al mismo tiempo (por ejemplo, «80 personas, casi todas en los primeros 5 minutos»).
- [ ] **Si pueden ser más de 40 con el mismo wifi:** hay dos salidas. La más simple: en la presentación decí «anótense con los datos de su celular, no con el wifi de la sala» (con datos, cada celular tiene su propia dirección). La otra: **(Mauro)** subir los topes en `packages/db/rls/0006_waitlist.sql` (un pull request chico) y correr `pnpm db:migrate`, **antes del 9/11**. Eso lo hace Mauro, nunca el mismo día.
- [ ] **Si pueden ser más de 60 en 10 minutos en total:** ídem, hay que subir el tope global.
- [ ] Avisale a Ani el mensaje de «Recibimos muchos pedidos…» para que sepa que no es una falla: es el freno.

### El código QR
- [ ] **(Mauro)** El dominio nuevo (`afiniajobs.com.ar`) se conecta después del 6/11. **Lunes 9/11: decidir cuál QR se usa** (regla en el README: si el dominio nuevo abre bien en dos celulares, el nuevo; si no, el de respaldo).
- [ ] Probar el QR con **dos celulares**, uno con wifi y otro con datos, **al mismo tiempo** (pasos en el README). Tiene que abrir «Pedir acceso» y tener «Voces Jóvenes» en «Cómo te enteraste».
- [ ] **Ani:** poné el QR **grande** en la diapositiva (que ocupe al menos un tercio del alto), sobre fondo blanco, **sin recortar el borde blanco y sin logo encima**. Escribí debajo la dirección corta (`…/acceso`).
- [ ] Probá desde **el fondo de la sala** (o a la distancia más lejana) que un celular lo lee. Si cuesta, agrandalo.
- [ ] Tené una **segunda diapositiva escondida con el otro QR** por si falla el principal.
- [ ] **Lo que dice Ani sobre el cupo,** palabra más, palabra menos: «Anotarse no asegura un lugar. El cupo es limitado y vamos a escribirles a quienes elijamos.»

### El panel de la lista de espera (Mauro)
- [ ] Entrá con tu cuenta de administrador a `https://<dominio>/settings/invitations` (con `<dominio>` el que corresponda). Abajo, buscá **«Lista de espera (N sin invitar)»**. Si no aparece, tu cuenta no está habilitada como administrador: resolvelo antes del evento (`docs/beta/runbook-apertura.md`, 1.2).
- [ ] Hacé la prueba de los dos celulares (README) y mirá que las dos anotaciones de prueba aparezcan **con «Voces Jóvenes» como origen**. Ponelas con «PRUEBA» en el nombre.
- [ ] Mirá que arriba aparezcan los **contadores por carrera** («Abogacía 0 de 0», etc.) y que el filtro **«Cómo se enteró»** funcione.
- [ ] Probá el botón **«Exportar a CSV»** (es una planilla que se abre con Excel o con Google Sheets) y fijate que traiga solo nombre, email, carrera, cómo se enteró y fecha.
- [ ] `https://<dominio>/api/health` tiene que responder `{"ok":true,"db":"ok"}`.
- [ ] Dejá abierta la compu con el panel el día del evento, y el celular con datos para probar la página desde afuera.

---

## Durante (miércoles 11/11)

### Ani, en la sala
1. Mostrá el QR y la dirección corta. Pedí que se anoten con **los datos del celular** si el wifi del lugar es flojo.
2. Repetí que anotarse **no asegura lugar**.
3. Si alguien no puede escanear, que escriba la dirección a mano y ponga «Voces Jóvenes» en «Cómo te enteraste».
4. Si a alguien le dice «Recibimos muchos pedidos…», que espere unos minutos o use datos del celular.

### Mauro, en el panel (recargá cada 10 o 15 minutos)
- [ ] **El número «sin invitar» sube.** Si la sala dice que se anotó y el número no se mueve, probá la página desde tu celular: puede ser el freno de seguridad o un problema de la página (README, «Si el día del evento la página no carga»).
- [ ] **Los contadores por carrera** muestran las 6 carreras de la beta y gente repartida. Si alguien eligió una carrera fuera de las 6, es normal: se anota igual, pero la beta es para esas 6.
- [ ] **«Cómo se enteró» dice «Voces Jóvenes»** en casi todas las filas. Si muchas dicen «Sin dato», el QR no está cargando el origen: usan la dirección escrita a mano. No es grave: igual quedan anotadas.
- [ ] Filtrá por **«Cómo se enteró» → «Voces Jóvenes»** para ver solo a la gente del evento.
- [ ] **Si las personas ven errores o la página no carga:** README, «Si el día del evento la página no carga». Cambiar al otro QR es lo primero.
- [ ] El panel muestra solo las **500 personas más recientes**: si se llega a ese número, aparece un aviso (no debería pasar).
- [ ] **No invites a nadie ese día.** Los mensajes de invitación salen recién desde el 12/11 (así las invitaciones, que duran 14 días, siguen vigentes el 26/11).

---

## Después (desde el jueves 12/11)

### Exportar la lista (Mauro)
- [ ] **12/11, a la mañana:** entrá al panel, filtrá por **«Cómo se enteró» → «Voces Jóvenes»** si querés ver solo el evento (o dejá todos), y tocá **«Exportar a CSV»**. Se descarga una planilla con nombre, email, carrera, origen y fecha.
- [ ] **Ojo con los datos personales:** la planilla tiene nombres y emails. Guardala solo en tu cuenta (no la mandes por WhatsApp ni la subas a un lugar público) y borrala cuando termine la selección.
- [ ] Pasale la planilla a Ani (o abrila juntos en pantalla).

### Elegir a quién invitar (Ani y Mauro)
- [ ] **Ani trae los criterios** para elegir (los que definió para las 15 a 20 personas que pagan y las 3 becadas). **Hasta que estén definidos, no se invita a nadie.**
- [ ] Revisen la lista **carrera por carrera** con los contadores del panel: ¿alcanza gente en cada una de las 6?
- [ ] Marquen en la planilla a quiénes eligen y quiénes quedan en espera. **Las 3 becas se marcan aparte.**
- [ ] **(Mauro)** En el panel, tildá a las personas elegidas (hasta 20 por tanda), tocá **«Invitar a los seleccionados»** y confirmá.
- [ ] **Copiá los mensajes en ese momento:** los enlaces se muestran **una sola vez**. Cada mensaje dice que la beta abre el jueves 26/11 y que el enlace es personal. Mandalos por WhatsApp o email desde tu cuenta: el panel no manda nada solo.
- [ ] Cada invitación **vence a los 14 días** y sirve una sola vez. Si alguien no la usó, se revoca y se crea de nuevo desde el mismo panel.
- [ ] A quienes **no** quedan, escribirles un mensaje corto y amable: «Gracias por anotarte. Esta vez no tenemos lugar; si se libera uno, te escribimos.» **No prometan** una fecha ni un lugar.
- [ ] Cuando alguien se registra, **su carrera ya viene marcada** en el primer paso (la que eligió al anotarse); puede cambiarla.

### Antes del jueves 26/11
- [ ] Seguir `docs/beta/runbook-apertura.md`: las invitaciones, el ensayo con testers del 20 al 24/11 y la apertura.
