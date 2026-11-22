# Detector de instrucciones en avisos

El texto de un aviso (descripción, título, empresa, notas) viene de terceros y entra al prompt del evaluador. `detectEvaluatorInjection` y `detectJobInjection` (`packages/pipeline/src/evaluator/injection.ts`) buscan en ese texto frases que parecen órdenes al modelo («ignorá las instrucciones anteriores…») y, si saltan, marcan la oferta con una señal y un riesgo.

## Es una capa más, no la defensa principal

El detector es una **lista de patrones**. Tiene límites conocidos y no se promete que atrape todo: quien conozca la lista puede redactar un rodeo que no coincida. Por eso no es lo que protege al sistema. La defensa principal es estructural:

- **El código decide, el modelo evalúa.** Ninguna salida del modelo dispara una acción: pasa por `decide()` y por la validación con Zod. Un aviso que logre subir un score no cambia estados ni envía nada.
- **Topes de gasto y de entrada.** Cada llamada al modelo tiene tope de tamaño y de costo, por persona y global.
- **El aviso es un dato delimitado.** Entra al prompt entre marcas, con una advertencia de que es contenido no confiable, y las marcas del aviso se neutralizan.
- **Lo que el modelo devuelve se muestra escapado**, nunca como HTML.

El detector suma una señal visible (la marca y el riesgo de la oferta) para que la persona sepa que el aviso trae algo raro. Si no salta, el resto de las defensas siguen igual.

## Qué cubre hoy

Órdenes directas en inglés y en español; letras separadas por espacios, guiones u otros separadores; cifras en lugar de letras; caracteres de ancho cero y de formato; mezcla de alfabetos parecidos; y los mismos patrones en los demás campos que entran al prompt. Los casos fijados están en `injection*.test.ts`.

## Límites conocidos

- Rodeos de frase que no usan las palabras de la lista.
- Letras sueltas con un solo espacio también entre palabras.
- Idiomas sin patrones.

Quedan como `it.todo` en `injection-limites.test.ts`. Ampliar la cobertura se decide midiendo (falsos positivos sobre avisos reales) antes de tocar la lista o el prompt.
