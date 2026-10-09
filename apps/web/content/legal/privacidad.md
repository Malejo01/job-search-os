---
actualizado: 2026-10-07
---

# Política de privacidad (borrador, no vigente)

> **Borrador para revisión.** No está vigente hasta que [RESPONSABLE] lo apruebe. Los pasajes marcados [A REVISAR] citan la ley 25.326 y su decreto reglamentario de memoria y hay que cotejarlos con el texto oficial. No es asesoramiento legal. El inventario que sostiene este texto está en `docs/legal/datos-por-proveedor.md`.

## 1. Quién es el responsable

Job Search OS es una herramienta en beta cerrada. El responsable del tratamiento de tus datos es **[RESPONSABLE]**, con domicilio en **[DOMICILIO]**. Contacto para cualquier consulta o pedido sobre tus datos: **[EMAIL DE CONTACTO]**.

## 2. Qué datos tratamos

- **Cuenta:** tu email y una versión cifrada (hash) de tu contraseña. No guardamos tu contraseña en claro.
- **Perfil que cargás:** nombre, titular, país y ciudad, preferencia por trabajo remoto, autorización de trabajo, años de experiencia, nivel de inglés, piso salarial, horas semanales máximas, zona horaria y un resumen de tu perfil. Si los cargás, también hechos verificables de tu trayectoria (proyectos, logros, fuentes), respuestas fijas para formularios (disponibilidad, tipo de contratación, links) y respuestas que aprobaste.
- **Avisos de empleo:** los que cargás vos o llegan por los emails que reenviás (empresa, título, ubicación, sueldo, texto del aviso, link) y las evaluaciones que genera el sistema.
- **Emails que reenviás:** el sistema te asigna una dirección propia de ingesta, con el formato `u_<20 caracteres>@dominio`. De los remitentes que reconoce como fuentes de empleo guarda el email completo para extraer los avisos. Podés ampliar esa lista marcando otros dominios como "empleo": desde ese momento, los emails de esos dominios se guardan completos. De los demás remitentes guarda solo remitente, destinatarios, asunto y fecha, sin el cuerpo. Los emails de inicio de sesión, verificación o códigos se descartan al llegar: guardamos solo remitente, destinatarios, fecha y el asunto con los números ocultos, sin el cuerpo. El pedido de confirmación de reenvío de Gmail dirigido a tu dirección se guarda completo para que puedas confirmarlo desde la bandeja. Ver la sección 6 sobre lo que escapa a este filtro.
- **Seguimiento que cargás:** postulaciones que hiciste por tu cuenta, contactos de reclutadores, plan de aprendizaje, entrevistas de skills.
- **Datos técnicos:** registro de llamadas a modelos de IA (qué tarea, modelo, cantidad de tokens, costo y duración; no guardamos ahí los textos que se envían ni las respuestas, y ante un error guardamos solo un código técnico, como el tipo de error y el código HTTP, sin el texto del proveedor), y registros de funcionamiento del servidor con tu identificador interno. Los registros de error pueden llevar el remitente del email reenviado (dato de un tercero) y fragmentos técnicos del fallo. No se publican. Los registros de funcionamiento del servidor los guarda el proveedor de hosting y siguen su plazo. Los registros técnicos de la base (registro de llamadas a modelos de IA, cola de trabajo y contadores de rechazos) se conservan por [A DEFINIR: plazo de retención de los logs].

**Datos de terceros.** Los emails y avisos pueden contener nombres y emails de reclutadores u otras personas. Los tratamos solo para mostrártelos y ordenar tu búsqueda. Es tu responsabilidad reenviar solo lo que tengas derecho a compartir (ver los Términos).

**No** buscamos tratar datos sensibles. Te pedimos que no cargues datos de salud, origen racial, ideas políticas, religión u otros datos sensibles definidos por la ley [A REVISAR: arts. 2 y 7 de la ley 25.326]. El sistema usa el resumen estructurado que cargás [A CONFIRMAR: que no se pida ni se procese el CV en archivo; ADR-008 prevé un paso de extracción de CV que todavía no tiene código].

## 3. Para qué los usamos

1. Crear y mantener tu cuenta e iniciar sesión.
2. Recibir y ordenar avisos de empleo.
3. Evaluar con IA qué tan bien calza cada aviso con tu perfil y redactar borradores de respuestas que revisás vos.
4. Controlar el costo de uso y la estabilidad del servicio.
5. Responder tus consultas y pedidos.

No usamos tus datos para publicidad, no los vendemos, y los datos de una persona no se usan para evaluar ni entrenar nada para otra. [CONFIRMAR con [RESPONSABLE]: es lo que dice la decisión de privacidad del proyecto (ADR-008); verificar que se cumple antes de publicar.]

## 4. Base legal: tu consentimiento

Tratamos tus datos con tu consentimiento libre, expreso e informado, que das al aceptar esta política y los Términos al registrarte [A REVISAR: arts. 5 y 6 de la ley 25.326]. Podés retirarlo en cualquier momento eliminando tu cuenta (sección 8); retirarlo no afecta lo tratado antes. Sin consentimiento no podemos darte el servicio.

## 5. Con quién compartimos datos y transferencias internacionales

Para funcionar usamos proveedores que tratan datos por nuestra cuenta. Varios están fuera de la Argentina, así que hay **transferencia internacional** de datos. Al aceptar esta política consentís esas transferencias [A REVISAR: art. 12 de la ley 25.326 y su decreto: la ley limita enviar datos a países sin nivel de protección adecuado salvo, entre otros casos, el consentimiento del titular o contratos con cláusulas modelo].

| Proveedor | Para qué | Qué datos recibe | Ubicación |
|---|---|---|---|
| Google (Gemini) | Principal para evaluar avisos y extraer skills; respaldo para redactar borradores | Resumen de tu perfil, ubicación, autorización de trabajo, piso salarial, horas, inglés, años, tus criterios y el texto del aviso; si actúa como respaldo de los borradores, también tus hechos del perfil, respuestas previas y las preguntas del formulario. No recibe tu nombre, email ni contraseña | [A CONFIRMAR: región] |
| Anthropic (Claude) | Principal para redactar borradores; respaldo para evaluar | Los mismos datos que Google para cada tarea | [A CONFIRMAR: región] |
| Resend | Recibir los emails que reenviás y enviar emails del servicio (recuperación de contraseña) | Los emails reenviados completos (los recibe antes de nuestro filtro) y tu email | [A CONFIRMAR: región] |
| Vercel | Alojar la aplicación | Tus consultas a la app y registros de funcionamiento | [A CONFIRMAR: región] |
| Neon | Base de datos | Todo lo que se guarda (sección 2) | [A CONFIRMAR: región] |

Según las condiciones comerciales de cada proveedor, el contenido enviado por API no se usa para entrenar sus modelos [A REVISAR: confirmar para el plan y la configuración contratados de Google y Anthropic antes de publicar esta frase]. Cada proveedor tiene sus propias políticas y plazos de conservación, que no controlamos.

Si usás la integración con Claude (MCP) con tu propia cuenta, ese tráfico lo regula tu relación con Anthropic. [CONFIRMAR si corresponde para la beta.]

Fuera de los proveedores, no compartimos tus datos con terceros salvo orden de autoridad competente.

## 6. Cuánto tiempo los conservamos

Conservamos tus datos mientras tu cuenta esté activa. El sistema borra automáticamente los enlaces de recuperación de contraseña vencidos o usados, y los registros técnicos (registro de llamadas a modelos de IA, cola de trabajo y contadores de rechazos de emails) más viejos que el plazo de logs: [A DEFINIR: plazo de retención de los logs]. Si ese plazo figura "en revisión", esos registros técnicos todavía no se borran. El registro de llamadas a IA se conserva al menos 90 días (es el registro de gastos) y los contadores de rechazos al menos 2 días. Los datos de tu cuenta (perfil, avisos, emails guardados y demás) no se borran por antigüedad sino cuando eliminás la cuenta (sección 8), con las excepciones que se listan ahí. Los registros del hosting siguen el plazo del proveedor, y los backups y registros de los demás proveedores se rigen por sus propios plazos.

**Qué no cubre el filtro de remitentes.** El filtro que evita guardar emails personales actúa al guardar en nuestra base. El proveedor de email puede haber recibido y retenido el mensaje completo antes. Por eso te recomendamos configurar el reenvío solo para las fuentes de empleo.

## 7. Cookies

Usamos solo **cookies técnicas** necesarias para el funcionamiento: la de sesión (dura como máximo 30 días) y las de seguridad del inicio de sesión. No usamos cookies de publicidad ni de seguimiento ni herramientas de analítica propias. [CONFIRMAR en el navegador nombres y atributos.]

## 8. Tus derechos

Tenés derecho a:

- **Acceso:** saber qué datos tuyos tenemos. Se ejerce de forma gratuita a intervalos no inferiores a seis meses, salvo que acredites un interés legítimo [A REVISAR: art. 14, inc. 3 de la ley 25.326, verificar literal].
- **Rectificación y actualización:** corregir tus datos pidiéndonoslo o, donde la app lo permita, desde ella [CONFIRMAR qué pantallas de edición existen].
- **Supresión:** pedirnos que borremos tus datos.
- **Retirar el consentimiento.**

**Cómo:** desde **Ajustes → "Eliminar mi cuenta"** o escribiendo a **[EMAIL DE CONTACTO]**. Por email, vamos a pedirte que acredites tu identidad. [A REVISAR: plazos legales de respuesta (acceso: 10 días corridos; rectificación y supresión: 5 días hábiles). Comprometer solo los plazos que [RESPONSABLE] pueda cumplir.]

**Qué borra "Eliminar mi cuenta":** tu cuenta, perfil, criterios, avisos, evaluaciones, emails guardados y sus originales, postulaciones, contactos, respuestas, registro de llamadas a modelos y demás datos con tu identificador.

**Qué NO alcanza el borrado:**

- Los **backups o el historial del proveedor de base de datos**, hasta que vence su plazo [A CONFIRMAR: plazo del plan].
- Los **registros de funcionamiento del hosting**, por el plazo de ese proveedor.
- Lo que el **proveedor de email** haya recibido o conserve de los emails reenviados.
- Los **catálogos compartidos** (empresas, skills y recursos de aprendizaje), que no pertenecen a una persona y no se borran con la cuenta.
- **Filas técnicas sin dueño** (por ejemplo, tareas en cola sin identificador de usuario), que pueden quedar hasta su limpieza.
- Los datos que una norma nos obligue a conservar.

Son limitaciones técnicas: esta política no promete un borrado absoluto e inmediato en sistemas de terceros.

## 9. Seguridad

Aplicamos medidas razonables [A REVISAR: art. 9 de la ley 25.326]: conexión cifrada (HTTPS), contraseñas guardadas con hash, aislamiento de datos por usuario en la base (seguridad a nivel de fila), webhook de email con firma verificada y límites de uso. Ningún sistema es infalible: no podemos garantizar seguridad absoluta. Si detectamos un incidente que afecte tus datos, te avisamos por el email de la cuenta [CONFIRMAR compromiso].

## 10. Menores

El servicio es para mayores de 18 años. Si detectamos una cuenta de un menor, la eliminamos.

## 11. Cambios

Podemos modificar esta política. Si el cambio es relevante, te avisamos por email o dentro de la app antes de que rija y te pedimos que la aceptes de nuevo. La fecha de última actualización está arriba.

## 12. Autoridad de control

La **Agencia de Acceso a la Información Pública (AAIP)** es el órgano de control de la ley 25.326 y atiende las denuncias y reclamos por incumplimiento de las normas de protección de datos personales [A REVISAR: texto literal].

Leyenda habitual en los bancos de datos [A REVISAR: verificar el texto literal antes de publicar]: "El titular de los datos personales tiene la facultad de ejercer el derecho de acceso a los mismos en forma gratuita a intervalos no inferiores a seis meses, salvo que se acredite un interés legítimo al efecto conforme lo establecido en el artículo 14, inciso 3 de la Ley Nº 25.326. La AGENCIA DE ACCESO A LA INFORMACIÓN PÚBLICA, en su carácter de Órgano de Control de la Ley Nº 25.326, tiene la atribución de atender las denuncias y reclamos que interpongan quienes resulten afectados en sus derechos por incumplimiento de las normas vigentes en materia de protección de datos personales."

## 13. Usuarios de otros países

El servicio se opera desde la Argentina y se rige por su ley. Si estás en otro país, tus datos se tratan como se describe acá; no aseguramos cumplir normas locales (por ejemplo, el RGPD europeo) que no nos apliquen. [CONSULTAR: si se invita a personas de la UE o del Reino Unido, analizarlo aparte.]
