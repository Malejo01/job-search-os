---
version: cv_coach_fallbacks@v1
task: cv_coach_fallbacks
---

# Preguntas de respaldo del coach de CV (ADR-038 §2)

> Se muestran tal cual cuando la pregunta que redactó el modelo no pasa el validador, y en la primera pregunta de la charla. El modelo no las ve ni las reformula.
> Formato y reglas: `packages/pipeline/src/cv-coach/turn/templates.ts`. Una sección por tipo de problema (`CV_ISSUE_TYPES`); cada tipo con la variante `puesto` y, si corresponde, `organizacion` (trabajo o estudio), `proyecto` y `habilidad`. Cada variante con su pregunta y su repregunta.
> Reglas de los textos: una sola línea, con «?», sin dígitos, sin links, sin preguntas sobre datos personales sensibles. Cada variante lleva su marcador (`{organizacion}`, `{proyecto}`, `{habilidad}` o `{puesto}`) y puede llevar además `{puesto}`.

## logro_sin_resultado

### organizacion
- pregunta: ¿Qué resultado concreto lograste en {organizacion}? Si podés contar cuánto mejoró algo, en qué plazo o a cuántas personas llegó, mejor. Si no se te ocurre, respondé «no tengo».
- repregunta: ¿Hubo algo en {organizacion} que haya salido mejor gracias a vos, aunque sea chico? Contámelo con tus palabras o respondé «no tengo».

### proyecto
- pregunta: ¿Qué resultado tuvo {proyecto}? Por ejemplo cuánta gente lo usó o qué mejoró. Si no tenés ese dato, respondé «no tengo».
- repregunta: ¿Qué pasó después de terminar {proyecto}? Cualquier resultado concreto sirve, aunque sea chico.

### puesto
- pregunta: Pensando en el puesto de {puesto}, ¿qué resultado concreto de tu experiencia te gustaría que se vea en el CV?
- repregunta: ¿Hay algún logro, aunque sea chico, que muestre lo que podés aportar como {puesto}?

## tarea_vaga

### organizacion
- pregunta: ¿Qué hacías en {organizacion} en el día a día? Contame las tareas principales con tus palabras: qué hacías, con qué herramientas y para quién.
- repregunta: Quiero entender mejor tu trabajo en {organizacion}. ¿Podés darme un ejemplo concreto de algo que hacías seguido?

### proyecto
- pregunta: ¿Qué hiciste vos en {proyecto}? Contame tu parte con tus palabras: qué armaste, con qué herramientas y para quién.
- repregunta: ¿Podés darme un ejemplo concreto de algo que hiciste en {proyecto}?

### puesto
- pregunta: Para el puesto de {puesto}, ¿qué tareas de tu experiencia te parece que más se relacionan? Contámelas con tus palabras.
- repregunta: ¿Podés darme un ejemplo concreto de una tarea que hacías y que sirva para {puesto}?

## vineta_sin_verbo

### organizacion
- pregunta: Algunas líneas de {organizacion} no dicen qué hacías vos. ¿Qué hacías exactamente ahí? Contámelo empezando por la acción, por ejemplo «armé», «coordiné» o «atendí».
- repregunta: ¿Qué parte del trabajo en {organizacion} hacías vos? Con una o dos acciones concretas alcanza.

### proyecto
- pregunta: En {proyecto} hay líneas que no dicen qué hiciste vos. ¿Qué hiciste exactamente? Contámelo empezando por la acción.
- repregunta: ¿Qué parte de {proyecto} hiciste vos? Con una o dos acciones concretas alcanza.

### puesto
- pregunta: Algunas líneas de tu CV no dicen qué hacías vos. ¿Qué acciones concretas querés que se lean pensando en {puesto}?
- repregunta: ¿Podés contarme una o dos acciones concretas tuyas que sirvan para {puesto}?

## skill_pedida_sin_evidencia

### habilidad
- pregunta: Los avisos de {puesto} piden {habilidad} y en tu CV no se ve dónde la usaste. ¿La usaste en algún trabajo, curso o proyecto? Si no, respondé «no tengo».
- repregunta: ¿En qué trabajo, curso o proyecto usaste {habilidad}, aunque sea poco? Si no la usaste, respondé «no tengo».

### puesto
- pregunta: Para {puesto} se piden herramientas que no se ven en tu CV. ¿Usaste alguna importante que no figure? Si no, respondé «no tengo».
- repregunta: ¿Hay alguna herramienta que uses para trabajar y no esté en tu CV para {puesto}? Si no, respondé «no tengo».

## proyecto_sin_stack_o_link

### proyecto
- pregunta: ¿Con qué herramientas hiciste {proyecto}? Si tiene un link público para verlo, pasámelo también.
- repregunta: Para que {proyecto} se entienda mejor, ¿qué herramientas usaste? Si no tiene link, no pasa nada.

### puesto
- pregunta: Pensando en {puesto}, ¿con qué herramientas hiciste tus proyectos? Si alguno tiene un link público, pasámelo.
- repregunta: ¿Qué herramientas usaste en tus proyectos, aunque sea en uno solo? Sirve para mostrar lo que hacés como {puesto}.

## brecha_con_puesto

### habilidad
- pregunta: Para {puesto} se pide mucho {habilidad}. ¿Tuviste contacto con eso en algún trabajo, curso o proyecto? Si no, respondé «no tengo».
- repregunta: ¿Hiciste algo, aunque sea chico, relacionado con {habilidad}? Si no, respondé «no tengo».

### puesto
- pregunta: Hay cosas que se piden para {puesto} que tu CV no muestra. ¿Hiciste algún curso, proyecto o tarea relacionada que no hayas puesto?
- repregunta: ¿Hay algo de tu experiencia relacionado con {puesto} que no esté en tu CV? Si no, respondé «no tengo».

## fecha_faltante

### organizacion
- pregunta: ¿Desde cuándo y hasta cuándo estuviste en {organizacion}? Mes y año alcanzan. Si seguís ahí, decímelo.
- repregunta: Para dejar bien las fechas de {organizacion}, ¿en qué mes y año empezaste y, si ya terminó, hasta cuándo?

### proyecto
- pregunta: ¿Cuándo hiciste {proyecto}? Mes y año alcanzan. Si sigue en curso, decímelo.
- repregunta: Para ubicar {proyecto} en tu CV, ¿en qué mes y año empezó y, si terminó, cuándo?

### puesto
- pregunta: A tu CV para {puesto} le faltan algunas fechas. ¿Me decís mes y año de inicio y de fin de lo que falta?
- repregunta: Para que tu CV para {puesto} se lea completo, ¿qué fechas faltan? Mes y año alcanzan.

## inconsistencia

### organizacion
- pregunta: Hay algo de {organizacion} en tu CV que no me cierra, por ejemplo las fechas o el cargo. ¿Me contás cómo fue?
- repregunta: Para dejar bien {organizacion}, ¿cuál era tu cargo y en qué meses estuviste ahí?

### proyecto
- pregunta: Hay algo de {proyecto} que no me cierra, por ejemplo las fechas o tu rol. ¿Me contás cómo fue?
- repregunta: Para dejar bien {proyecto}, ¿cuál fue tu rol y cuándo lo hiciste?

### puesto
- pregunta: Hay datos de tu CV que no coinciden entre sí. ¿Me ayudás a dejarlos bien para {puesto}? Contame qué fechas o cargos cambiaron.
- repregunta: ¿Qué dato de tu CV para {puesto} habría que corregir?

## resumen_generico

### puesto
- pregunta: Tu resumen podría ser de cualquier persona. ¿Qué te diferencia para trabajar como {puesto}? Por ejemplo en qué sos fuerte o qué problemas resolvés.
- repregunta: ¿Qué te gustaría que sepa de vos, en una línea, alguien que busca {puesto}?

## orden_poco_relevante

### puesto
- pregunta: Para {puesto}, ¿qué trabajo o proyecto de tu CV muestra mejor lo que sabés hacer?
- repregunta: ¿Cuál de tus experiencias se parece más a lo que harías como {puesto}?
