# Calibrar la evaluación nueva (R31-10)

Para qué sirve: antes de promover `evaluate_job@v1.5.0` hay que comprobar, con ofertas reales de testers, que la evaluación nueva está bien. Este kit pone las ofertas, las marcas y la exportación. **No cambia ningún puntaje ni ninguna decisión**: lo que se marca solo informa.

## Qué hace falta antes
1. La migración 0087, la 0088 y las RLS 0071, 0072 y 0073 aplicadas (ver `pasos-manuales-r31.md`).
2. `JOB_CARD=testers` encendida. Con la variable apagada la pantalla no existe (404) y la app se ve igual que al cerrar la R30.
3. Las ofertas de quien revisa evaluadas con la versión nueva: se consigue con la reevaluación única de R31-09 (con el prompt promovido o con la versión nueva elegida para la prueba) y con su tope de gasto.
4. Quien revisa es admin o tester (el mismo criterio que `/recorrido`).

## Cómo se usa
1. Entrar a **`/calibracion`**. Aparecen entre 20 y 30 ofertas propias, evaluadas con la versión nueva, **elegidas para ser variadas** (ver abajo).
2. En cada oferta:
   - **«¿Te sirve esta evaluación?»**: «Sí» solo agradece; «No» abre los motivos («Leyeron mal un requisito», «El puntaje no me parece justo», «Falta algo importante», «Otro») y un texto corto opcional.
   - **«Proponer otro puntaje»**: un puntaje de 0 a 10 y una nota, si el número no convence.
   - **«Abrir la oferta»** lleva al detalle, con la tabla de requisitos y las citas del aviso.
3. **No escribir datos personales en el motivo** (ni propios ni de otras personas): el admin lo recibe tal cual.
4. Arriba figura cuántas se marcaron y cuántas «de acuerdo» y «en desacuerdo».

## Cómo se eligen entre 20 y 30 ofertas variadas
La pantalla ya hace esta selección sola (función `selectCalibrationSet`), de las ofertas evaluadas con la versión nueva, y es **estable**: la lista no se mueve mientras se marca. Si hay que armarla a mano, estos son los criterios:

| Qué variar | Cómo |
|---|---|
| Carreras | Las 8 de la beta (abogacía, contaduría, administración, comunicación, marketing, relaciones públicas, relaciones internacionales, programación), 2 a 4 ofertas de cada una; ninguna se come el cupo. |
| Condición excluyente | En cada carrera, al menos una oferta **con** una condición del aviso que no coincide (por ejemplo residencia en otro país, presencial, jornada) y una **sin**. |
| Idioma del aviso | Español (la mayoría, incluidos avisos locales), inglés y portugués. |
| Modalidad | Remota, híbrida y presencial. |
| Datos del aviso | Con y sin descripción completa; con y sin número de candidatos; con y sin sueldo publicado. |
| Resultado | De puntaje alto, medio y bajo: no solo las que salieron bien. |

Si faltan ofertas de algún grupo, se anota en el informe de la calibración y se carga un aviso de ese tipo a mano antes de evaluar.

## Qué mirar en cada oferta
1. **Los requisitos.** ¿Cada fila de «Lo que pide el aviso» está en el aviso? Abrir «Así lo dice el aviso»: la cita tiene que decir lo que la fila afirma (por ejemplo, «remoto» no es «desde cualquier país»).
2. **El estado de cada fila.** «Coincide» solo con un dato tuyo que lo respalde; «No coincide» solo con un dato explícito distinto; si el perfil no tiene el dato, tiene que decir «Sin confirmar» y ofrecer la pregunta de un toque.
3. **Las condiciones aparte.** Modalidad, lugar, jornada, autorización: figuran como condiciones del aviso y **no bajan el puntaje**. Si el puntaje bajó por una condición, es un error.
4. **El área del puesto** figura como dato del aviso, nunca como un requisito que «coincide».
5. **Los riesgos.** «Muchos candidatos» solo aparece si el aviso trae el número, y lo muestra.
6. **El idioma.** Un aviso local en español no pide inglés; uno en inglés o en portugués no lo pide por estar escrito así.
7. **El puntaje.** ¿Va con el sello? ¿Te parece razonable para tu perfil y para ese puesto? Si no, proponer otro puntaje y decir por qué.
8. **El texto.** Sin «te falta», «no cumple», «match» ni «skills»; nada que prometa trabajo.

## Cómo se exporta (solo admins)
En `/calibracion`, el botón **«Exportar lo marcado (CSV)»** (o la ruta `/admin/calibracion/export`) baja un CSV con una fila por evaluación nueva marcada por cualquier persona:
- columnas: fecha, persona, oferta, título, empresa, versión, carrera, modalidad, inglés, aviso completo, puntaje, acción, condiciones, veredicto, motivo y puntaje propuesto;
- **sin email, sin nombre, sin datos del perfil ni identificador de la cuenta**: la persona es un código de 6 caracteres y la oferta, una referencia de 8 que no se puede revertir;
- el título y la empresa salen **solo de avisos del pool** (públicos); una oferta que la persona cargó sale sin ellos;
- las celdas que empiezan con `=`, `+`, `-` o `@` salen neutralizadas para que una planilla no las ejecute.

La exportación sale de una función de la base (`admin_calibration_marks`, RLS 0073) que exige ser admin y no recibe una persona como parámetro: no hay manera de pedir lo de una persona en particular.

## Cómo leer el resultado
- **De acuerdo sobre lo marcado**: la proporción de «Sí» sobre lo marcado. Hay que mirarla **por carrera**, no solo en total: un 90 % general puede esconder una carrera en 50 %.
- **En desacuerdo**: leer los motivos y agruparlos (requisito mal leído, puntaje, algo que falta). Cada grupo es una corrección de prompt o de código, con su caso en el golden.
- **Diferencia de puntaje**: promedio de (puntaje propuesto − puntaje de la evaluación) donde alguien propuso otro. Un sesgo en un solo sentido indica que la calibración está corrida.
- **Casos de condiciones**: confirmar que ninguna evaluación bajó el puntaje por una condición del aviso.
- La decisión de promover es del responsable. Este kit no fija un umbral: deja los números y los motivos para decidir con las evals de `ops/rondas/r31-tanda/R31-06/propuesta/LEEME.md`.

## Límites
- Las marcas son de la evaluación guardada de cada oferta: si se reevalúa, la marca queda en la evaluación anterior.
- Solo se ven las ofertas de quien entra (cada persona ve lo suyo por la RLS). La visión de todas las personas es únicamente la exportación del admin.
- No es una encuesta ni un puntaje oficial: no entra en el error medio ni en el snapshot.
