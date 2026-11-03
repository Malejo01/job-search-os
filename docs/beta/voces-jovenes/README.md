# Kit del QR para Voces Jóvenes (miércoles 11/11/2026)

Ani presenta la beta y la gente se anota escaneando un código QR que lleva a la página «Pedir acceso». Esta carpeta tiene los dos códigos, cuál usar y qué hacer si algo falla. La lista del día (antes, durante y después) está en [`checklist-evento.md`](./checklist-evento.md).

> **Recordatorio para la presentación:** anotarse **no asegura un lugar**. El cupo es limitado (15 a 20 personas que pagan, más 3 becadas) y Mauro, con los criterios de Ani, elige a quién invitar desde el 12/11. Lo dice la propia página al anotarse.

## Los archivos

| Archivo | Lleva a | Para qué |
|---|---|---|
| `qr-afiniajobs.png` y `.svg` | `https://afiniajobs.com.ar/acceso?origen=voces-jovenes` | El dominio nuevo (hoy todavía sin conectar) |
| `qr-respaldo.png` y `.svg` | `https://busquedalaboral.malejo.com.ar/acceso?origen=voces-jovenes` | El dominio de hoy: **ya funciona** |

- **PNG** (1024 × 1024 px): para las diapositivas y WhatsApp. **SVG**: para imprimir (no se pixela al agrandarlo).
- Los dos tienen el margen blanco de 4 cuadraditos que pide el estándar y corrección de errores nivel M (aguantan hasta un 15 % de daño). **No recortes el margen blanco ni le pongas un logo encima**: el celular necesita ese borde.
- La parte `?origen=voces-jovenes` hace que, al abrir la página, el campo «Cómo te enteraste» ya diga «Voces Jóvenes». Así el panel de la lista de espera sabe quiénes vienen del evento.

## Cuál usar

La decisión depende de una sola cosa: **¿el dominio nuevo (`afiniajobs.com.ar`) está conectado y probado antes de mandar las diapositivas a imprimir o a proyectar?** El cambio de dominio lo hace Mauro después de la aprobación de marca del 6/11 (`docs/DEPLOY.md`, «Pasar a afiniajobs.com.ar»).

1. **Fecha límite: lunes 9/11.** Ese día Mauro prueba el dominio nuevo con **dos celulares** (ver más abajo).
2. **Si el dominio nuevo carga bien en los dos celulares → usá `qr-afiniajobs`.** Poné también el QR de respaldo en una diapositiva escondida o en la última.
3. **Si no está listo o falla cualquier prueba → usá `qr-respaldo`.** No esperes: un QR que no abre es peor que uno con el nombre viejo.
4. **El QR de respaldo sigue sirviendo si el dominio cambia después.** Cuando Mauro conecta el dominio nuevo, el viejo redirige solo (con la misma ruta y el `?origen=voces-jovenes`) mientras esté cargada la variable `LEGACY_HOSTS`. Por eso, si hay duda, el respaldo es la opción segura. Lo que **no** conviene es imprimir el QR nuevo antes de comprobar que el dominio nuevo funciona.
5. **Escribí la dirección corta debajo del QR**, para quien no pueda escanear: `afiniajobs.com.ar/acceso` (o `busquedalaboral.malejo.com.ar/acceso`). Quien la escribe a mano no trae el `?origen`: pedile que en «Cómo te enteraste» ponga «Voces Jóvenes».

## Cómo probarlo con dos celulares

Hacelo la semana del 2 al 9/11 con el QR que pensás usar, y otra vez el 10/11 con el definitivo. Hace falta una pantalla con el QR (la compu o una diapositiva) y dos celulares, uno con wifi y el otro con datos móviles (sin wifi).

1. **Celular A (con wifi):** abrí la cámara, apuntá al QR en la pantalla y tocá el aviso que aparece. Tiene que abrir la página **«Pedir acceso»**. Si el celular pregunta si querés abrir la dirección en el navegador, aceptá.
2. Mirá que el campo **«Cómo te enteraste»** ya diga **«Voces Jóvenes»**.
3. Completá el formulario con datos de prueba (nombre «PRUEBA Voces», un email tuyo, una carrera) y tocá **«Pedir acceso»**. Tiene que aparecer: «Listo, te anotamos. La beta abre el jueves 26/11 y el cupo es limitado: si hay lugar, te escribimos con el link para crear tu cuenta.»
4. **Celular B (con datos móviles, sin wifi):** repetí los pasos 1 a 3, con otro email. Así comprobás que la página abre desde afuera de tu red.
5. **Probá con los dos a la vez** desde la misma diapositiva, como pasará en la sala.
6. En la compu, entrá al panel de la lista de espera (`/settings/invitations`, con la cuenta de Mauro) y fijate que aparecen las dos pruebas, con «Voces Jóvenes» como origen.
7. **Probá también al revés:** escribí a mano la dirección corta en un celular. Tiene que abrir igual (sin el origen).
8. **Anotá qué celulares usaste** (marca y si era Android o iPhone). Si alguno no escanea, probá subiendo el brillo de la pantalla y agrandando el QR.
9. Las anotaciones de prueba quedan en la lista. Poné «PRUEBA» en el nombre para no invitarlas por error. Si querés borrarlas, lo hace Mauro desde la base con un borrado puntual, revisado antes.

## Si el día del evento la página no carga

1. **Primero, calmar a la sala:** «Anótense en un rato desde su casa, les dejamos el enlace.» No pasa nada por perder 5 minutos.
2. **Mirá si es un problema de la sala o de la página:** probá la dirección desde tu celular con datos móviles. Si carga ahí, el problema es el wifi del lugar: pedí que usen los datos de sus celulares.
3. **Cambiá al otro QR.** Tené los dos listos en la presentación (uno en la diapositiva y el otro en una escondida). Si falló el dominio nuevo, mostrá el de respaldo, y al revés.
4. **Mirá el estado de la app:** `https://<dominio>/api/health` tiene que responder `{"ok":true,"db":"ok"}`. Si no responde, Mauro sigue `docs/beta/runbook-apertura.md`, sección 3.2 («Un deploy roto»).
5. **Si dice «Recibimos muchos pedidos desde tu conexión. Probá de nuevo en un rato.»:** es el freno de seguridad de la lista (40 anotaciones por hora desde el mismo wifi, 60 cada 10 minutos entre todos, 600 por día). Pedí que usen datos móviles; para más adelante, ver «Topes» en el checklist.
6. **Plan B en papel:** una hoja con columnas Nombre · Email · Carrera para quien no pueda anotarse. **El panel no permite cargar personas a mano**, así que después Mauro les manda el enlace por email o WhatsApp para que se anoten ellas mismas. Avisales que esa persona está «anotada» recién cuando se anota en la página.
7. **No inventes disculpas largas ni prometas lugar.** Lo único que se promete es que, si hay lugar, se les escribe.

## Cómo se generaron (por si hay que rehacerlos)

Con un paquete de `npx`, sin agregar nada al repo. Nivel de corrección M, margen de 4 cuadraditos y 1024 px:

```bash
npx --yes qrcode@1.5.4 -t png -e M -q 4 -w 1024 -o qr-afiniajobs.png "https://afiniajobs.com.ar/acceso?origen=voces-jovenes"
```

```bash
npx --yes qrcode@1.5.4 -t png -e M -q 4 -w 1024 -o qr-respaldo.png "https://busquedalaboral.malejo.com.ar/acceso?origen=voces-jovenes"
```

Los SVG salen del mismo paquete (`-t svg`). Después de generar uno nuevo, comprobá siempre que el celular abre la dirección correcta: el QR guarda el texto exacto de la dirección, así que un cambio de dominio obliga a rehacerlo.
