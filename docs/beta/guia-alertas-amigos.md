# Guía: alertas de Computrabajo hacia AfinIAJobs

Para quien quiere ayudar a que AfinIAJobs tenga más ofertas de su carrera. Son unos 10 minutos y se hace una sola vez. No postula a nada en tu nombre, no entra a tu cuenta de Computrabajo y no mira el resto de tu correo.

**Qué se reenvía:** solo los emails que llegan desde `computrabajo.com`, a una casilla del sistema que corresponde a tu carrera. Nada más. El filtro no tiene la opción «reenviar todo» y no podés armarlo por error con ese alcance: el archivo que te pasamos ya trae el remitente puesto.

**Qué se guarda:** los avisos de esas alertas (título, empresa, ubicación y link público). Se descartan los parámetros del link que te identifican a vos. Los emails sin leer se borran a los 30 días.

## Antes de empezar

Quien administra la beta te pasa **un archivo XML** (`filtro-pool-<tu carrera>.xml`) y te avisa el momento en que va a estar atento para el código del paso 2. Un archivo por persona: no importes el de otra carrera.

## 1. Crear la alerta en Computrabajo

1. Entrá a Computrabajo con tu cuenta (la que usás con tu Gmail).
2. Creá una alerta de empleo con el puesto o la carrera que te interesa y dejala con aviso por email.
3. Confirmá que te llegue al menos un email de alertas a tu Gmail.

## 2. Verificar la dirección de reenvío

Gmail pide confirmar cualquier dirección a la que reenvíes correo.

1. En Gmail, abrí **Configuración** (el engranaje) → **Ver toda la configuración** → pestaña **Reenvío y correo POP/IMAP**.
2. Tocá **Agregar una dirección de reenvío** y pegá la dirección de la casilla de tu carrera, con la forma `pool-<tu carrera>@<dominio de ingesta>`. Te la pasa quien administra la beta.
3. Gmail manda un email con un **código de confirmación** a esa casilla. Tu Gmail no lo ve: el código lo lee quien administra la beta en Resend → Receiving, y te lo pasa por mensaje.
4. Ponelo en Gmail y confirmá. **No actives** «Reenviar una copia de los mensajes entrantes»: el reenvío lo hace el filtro del paso siguiente, solo para Computrabajo.

## 3. Importar el filtro

1. En la misma configuración, abrí la pestaña **Filtros y direcciones bloqueadas**.
2. Tocá **Importar filtros** → **Elegir archivo** y seleccioná el XML que te pasaron → **Abrir archivo**.
3. Revisá que el filtro diga `from:(computrabajo.com)` y «Reenviarlo a: pool-…». Marcalo y tocá **Crear filtros**.

Listo. La próxima alerta de Computrabajo se copia sola. Si algo no coincide con lo que ves acá (por ejemplo, el filtro no tiene el remitente), no lo crees: avisale a quien administra la beta.

## Darte de baja

Podés cortarlo cuando quieras, sin avisar:

1. En **Filtros y direcciones bloqueadas**, buscá el filtro de Computrabajo y tocá **eliminar**.
2. En **Reenvío y correo POP/IMAP**, quitá la dirección de reenvío.
3. Si querés, desactivá también la alerta en Computrabajo.

Lo que ya se copió se borra solo a los 30 días.
