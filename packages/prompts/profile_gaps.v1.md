---
version: profile_gaps@v1
task: profile_gaps
---

# Preguntas de la charla de huecos (agente de perfil, ADR-034)

> Estas preguntas se muestran tal cual: el modelo no las redacta ni las reformula. `cv_interview` solo extrae lo que la persona contesta.
> Formato y reglas: `packages/pipeline/src/profile-agent/gaps/templates.ts`. Una sección por carrera de la beta y una `default`; cada tema con su pregunta y su repregunta (salvo `skill_level`, que se contesta con botones).
> Reglas de los textos: una sola línea, con «?», sin dígitos, sin links, sin preguntas sobre datos personales sensibles. Marcadores permitidos: `{organizacion}` en los temas de trabajo y `{habilidad}` en `skill_level`.

## default

### achievement
- pregunta: ¿Qué lograste en {organizacion} que haya mejorado algo o salido bien? Si podés ponerle un número o un resultado concreto, mejor. Si no se te ocurre, respondé «no tengo».
- repregunta: ¿Hubo algo concreto que hayas logrado o mejorado en {organizacion}, aunque sea chico? Si no se te ocurre, respondé «no tengo».

### duties
- pregunta: ¿Qué tareas hacías en {organizacion} en el día a día? Contame las principales, de una a cuatro, con tus palabras.
- repregunta: Quiero entender mejor tu día a día en {organizacion}. ¿Podés contarme con más detalle qué hacías, por ejemplo con qué herramientas o con quién trabajabas?

### dates
- pregunta: ¿Desde cuándo y hasta cuándo trabajaste en {organizacion}? Mes y año alcanzan. Si seguís ahí, decímelo.
- repregunta: Para dejar bien las fechas de {organizacion}, ¿en qué mes y año empezaste y, si ya terminó, hasta cuándo? Si seguís ahí, avisame.

### skill_level
- pregunta: ¿Cuánto usaste {habilidad}? Elegí el nivel que mejor te describe.

## abogacia

### achievement
- pregunta: ¿Qué resultado lograste en {organizacion}, por ejemplo un caso, un acuerdo, un dictamen o un trámite resuelto? Si podés ponerle un número o un plazo, mejor. Si no tenés, respondé «no tengo».
- repregunta: ¿Hubo algún caso o trámite concreto que hayas llevado adelante en {organizacion}, aunque sea chico? ¿Cómo terminó? Si no se te ocurre, respondé «no tengo».

### duties
- pregunta: ¿Qué tareas hacías en {organizacion}? Por ejemplo redacción de escritos, atención de clientes, seguimiento de expedientes o audiencias. Contame las principales, de una a cuatro.
- repregunta: ¿Podés darme más detalle de tu trabajo en {organizacion}? Por ejemplo qué tipo de casos o materias llevabas y qué parte te tocaba a vos.

### dates
- pregunta: ¿Desde cuándo y hasta cuándo trabajaste en {organizacion}? Mes y año alcanzan. Si seguís ahí, decímelo.
- repregunta: Para dejar bien las fechas de {organizacion}, ¿en qué mes y año empezaste y, si ya terminó, hasta cuándo? Si seguís ahí, avisame.

### skill_level
- pregunta: ¿Cuánto usaste {habilidad}? Elegí el nivel que mejor te describe.

## finanzas_contabilidad

### achievement
- pregunta: ¿Qué lograste en {organizacion}, por ejemplo un cierre más rápido, un ahorro, una conciliación o un proceso ordenado? Si podés ponerle un número o un plazo, mejor. Si no tenés, respondé «no tengo».
- repregunta: ¿Hubo algo concreto que hayas mejorado o resuelto en {organizacion}, aunque sea chico? Si no se te ocurre, respondé «no tengo».

### duties
- pregunta: ¿Qué tareas hacías en {organizacion}? Por ejemplo liquidaciones, conciliaciones, facturación, impuestos o reportes. Contame las principales, de una a cuatro.
- repregunta: ¿Podés darme más detalle de tu día a día en {organizacion}? Por ejemplo con qué sistemas trabajabas y qué parte del proceso te tocaba.

### dates
- pregunta: ¿Desde cuándo y hasta cuándo trabajaste en {organizacion}? Mes y año alcanzan. Si seguís ahí, decímelo.
- repregunta: Para dejar bien las fechas de {organizacion}, ¿en qué mes y año empezaste y, si ya terminó, hasta cuándo? Si seguís ahí, avisame.

### skill_level
- pregunta: ¿Cuánto usaste {habilidad}? Elegí el nivel que mejor te describe.

## administracion_empresas

### achievement
- pregunta: ¿Qué lograste en {organizacion}, por ejemplo un proceso mejorado, un costo reducido, un equipo coordinado o un proyecto entregado? Si podés ponerle un número, mejor. Si no tenés, respondé «no tengo».
- repregunta: ¿Hubo algo concreto que hayas mejorado o entregado en {organizacion}, aunque sea chico? Si no se te ocurre, respondé «no tengo».

### duties
- pregunta: ¿Qué tareas hacías en {organizacion}? Por ejemplo coordinación de equipos, seguimiento de presupuestos, compras, planificación o atención de proveedores. Contame las principales, de una a cuatro.
- repregunta: ¿Podés darme más detalle de tu día a día en {organizacion}? Por ejemplo con quién trabajabas y qué parte de la gestión te tocaba a vos.

### dates
- pregunta: ¿Desde cuándo y hasta cuándo trabajaste en {organizacion}? Mes y año alcanzan. Si seguís ahí, decímelo.
- repregunta: Para dejar bien las fechas de {organizacion}, ¿en qué mes y año empezaste y, si ya terminó, hasta cuándo? Si seguís ahí, avisame.

### skill_level
- pregunta: ¿Cuánto usaste {habilidad}? Elegí el nivel que mejor te describe.

## comunicacion

### achievement
- pregunta: ¿Qué lograste en {organizacion}, por ejemplo una campaña, una nota, un evento o un crecimiento de audiencia? Si podés ponerle un número, mejor. Si no tenés, respondé «no tengo».
- repregunta: ¿Hubo algún trabajo concreto que haya salido bien en {organizacion}, aunque sea chico? ¿Qué pasó con él? Si no se te ocurre, respondé «no tengo».

### duties
- pregunta: ¿Qué tareas hacías en {organizacion}? Por ejemplo redacción, producción de contenido, edición, manejo de redes o prensa. Contame las principales, de una a cuatro.
- repregunta: ¿Podés darme más detalle de tu día a día en {organizacion}? Por ejemplo qué tipo de piezas producías y con qué herramientas.

### dates
- pregunta: ¿Desde cuándo y hasta cuándo trabajaste en {organizacion}? Mes y año alcanzan. Si seguís ahí, decímelo.
- repregunta: Para dejar bien las fechas de {organizacion}, ¿en qué mes y año empezaste y, si ya terminó, hasta cuándo? Si seguís ahí, avisame.

### skill_level
- pregunta: ¿Cuánto usaste {habilidad}? Elegí el nivel que mejor te describe.

## marketing_digital

### achievement
- pregunta: ¿Qué resultado lograste en {organizacion}, por ejemplo más alcance, más clientes potenciales, mejor conversión o menor costo por resultado? Si tenés un número, mejor. Si no tenés, respondé «no tengo».
- repregunta: ¿Hubo alguna campaña o acción concreta que haya funcionado en {organizacion}, aunque sea chica? ¿Qué cambió? Si no se te ocurre, respondé «no tengo».

### duties
- pregunta: ¿Qué tareas hacías en {organizacion}? Por ejemplo campañas pagas, redes, email, análisis de métricas o posicionamiento web. Contame las principales, de una a cuatro.
- repregunta: ¿Podés darme más detalle de tu día a día en {organizacion}? Por ejemplo con qué plataformas trabajabas y qué parte del embudo te tocaba.

### dates
- pregunta: ¿Desde cuándo y hasta cuándo trabajaste en {organizacion}? Mes y año alcanzan. Si seguís ahí, decímelo.
- repregunta: Para dejar bien las fechas de {organizacion}, ¿en qué mes y año empezaste y, si ya terminó, hasta cuándo? Si seguís ahí, avisame.

### skill_level
- pregunta: ¿Cuánto usaste {habilidad}? Elegí el nivel que mejor te describe.

## relaciones_publicas

### achievement
- pregunta: ¿Qué lograste en {organizacion}, por ejemplo una cobertura en medios, un evento, un vínculo con una institución o el manejo de una situación difícil? Si podés ponerle un número, mejor. Si no tenés, respondé «no tengo».
- repregunta: ¿Hubo algún evento o vínculo concreto que haya salido bien en {organizacion}, aunque sea chico? ¿Qué resultado tuvo? Si no se te ocurre, respondé «no tengo».

### duties
- pregunta: ¿Qué tareas hacías en {organizacion}? Por ejemplo gacetillas, organización de eventos, vínculo con prensa, atención de invitados o comunicación institucional. Contame las principales, de una a cuatro.
- repregunta: ¿Podés darme más detalle de tu día a día en {organizacion}? Por ejemplo con qué públicos o instituciones trabajabas y qué parte te tocaba a vos.

### dates
- pregunta: ¿Desde cuándo y hasta cuándo trabajaste en {organizacion}? Mes y año alcanzan. Si seguís ahí, decímelo.
- repregunta: Para dejar bien las fechas de {organizacion}, ¿en qué mes y año empezaste y, si ya terminó, hasta cuándo? Si seguís ahí, avisame.

### skill_level
- pregunta: ¿Cuánto usaste {habilidad}? Elegí el nivel que mejor te describe.

## relaciones_internacionales

### achievement
- pregunta: ¿Qué lograste en {organizacion}, por ejemplo un informe, una gestión con otro país u organismo, un proyecto de cooperación o una delegación coordinada? Si podés ponerle un número, mejor. Si no tenés, respondé «no tengo».
- repregunta: ¿Hubo algún informe o gestión concreta que haya salido bien en {organizacion}, aunque sea chica? ¿Qué resultado tuvo? Si no se te ocurre, respondé «no tengo».

### duties
- pregunta: ¿Qué tareas hacías en {organizacion}? Por ejemplo redacción de informes, análisis de temas internacionales, traducción o coordinación con otros países u organismos. Contame las principales, de una a cuatro.
- repregunta: ¿Podés darme más detalle de tu día a día en {organizacion}? Por ejemplo con qué instituciones o regiones trabajabas y qué parte te tocaba a vos.

### dates
- pregunta: ¿Desde cuándo y hasta cuándo trabajaste en {organizacion}? Mes y año alcanzan. Si seguís ahí, decímelo.
- repregunta: Para dejar bien las fechas de {organizacion}, ¿en qué mes y año empezaste y, si ya terminó, hasta cuándo? Si seguís ahí, avisame.

### skill_level
- pregunta: ¿Cuánto usaste {habilidad}? Elegí el nivel que mejor te describe.

## fullstack

### achievement
- pregunta: ¿Qué lograste en {organizacion}, por ejemplo una función que lanzaste, una mejora de velocidad o un error crítico resuelto? Si tenés un número, mejor. Si no tenés, respondé «no tengo».
- repregunta: ¿Hubo algo concreto que hayas construido o mejorado en {organizacion}, aunque sea chico? ¿Qué cambió gracias a eso? Si no se te ocurre, respondé «no tengo».

### duties
- pregunta: ¿Qué tareas hacías en {organizacion}? Por ejemplo desarrollo de pantallas, servicios y APIs, bases de datos, pruebas o despliegues. Contame las principales, de una a cuatro.
- repregunta: ¿Podés darme más detalle de tu día a día en {organizacion}? Por ejemplo con qué tecnologías trabajabas y en qué parte del sistema te tocaba a vos.

### dates
- pregunta: ¿Desde cuándo y hasta cuándo trabajaste en {organizacion}? Mes y año alcanzan. Si seguís ahí, decímelo.
- repregunta: Para dejar bien las fechas de {organizacion}, ¿en qué mes y año empezaste y, si ya terminó, hasta cuándo? Si seguís ahí, avisame.

### skill_level
- pregunta: ¿Cuánto usaste {habilidad}? Elegí el nivel que mejor te describe.
