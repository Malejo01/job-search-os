# Guion de 30 minutos por carrera (ensayo del 23 y 24/11)

Qué hace cada tester en media hora. Es la versión corta de dos guías que ya existen y que no se repiten acá:

- `docs/beta/ensayo-testers.md`: la guía paso a paso para quien prueba, con la planilla de resultados.
- `docs/beta/ensayo.md`: el recorrido largo de quien organiza (25 minutos por carrera, con avisos inventados y 13 pasos).

Este guion es el mínimo común: **todos los testers hacen los mismos 8 pasos**, y cada carrera suma una verificación propia (tabla del final). Todo con datos inventados o con avisos reales que el tester elija, nunca datos de otras personas.

## Los 8 pasos (30 minutos)

| Min | Paso | Qué hacer | Qué tiene que pasar |
| --- | --- | --- | --- |
| 0 a 3 | 1. Entrar | Abrir el enlace de invitación personal en el celular y crear la cuenta | Abre el registro con la marca; la carrera puede venir marcada |
| 3 a 8 | 2. Onboarding | Paso 1 (carrera, país, inglés, años, resumen) y paso 2 (skills, o «Saltear por ahora») | Se entiende qué pide cada paso; la carrera está en la lista |
| 8 a 12 | 3. Primeras ofertas | Paso 3: mirar las ofertas que muestra la app para la carrera | Hay ofertas de la carrera, o la pantalla dice por qué no |
| 12 a 17 | 4. Cargar dos ofertas | **«+ Cargar oferta»** (en Ofertas): una **pegada** (texto del aviso) y, si la función está mergeada y encendida, otra **desde una imagen** (captura del aviso) | Las dos aparecen; la imagen se lee sin inventar datos (si falla, que lo diga) |
| 17 a 22 | 5. Leer la evaluación | Abrir una oferta evaluada: puntaje, «A tu favor», «Te falta o te frena» | El motivo se entiende y coincide con lo que el tester pensaría |
| 22 a 24 | 6. «Me sirve» | Tocar 👍 o 👎 en «¿Te sirve esta evaluación?»; con 👎, elegir un motivo | Queda guardado; agradece |
| 24 a 27 | 7. Primeros pasos | Abrir «Empezá acá» en `/hoy` (Primeros pasos) | Muestra el perfil hecho y lo que falta; se puede cerrar |
| 27 a 30 | 8. Asistente | Si el tester lo ve (solo habilitados): preguntar «¿qué me falta para las ofertas que me interesan?» y mirar que no escriba nada sin confirmar. Cerrar con **«¿Algo no anduvo?»**: mandar un comentario aunque sea de prueba | El asistente propone, no guarda solo. El comentario llega («¡Gracias!») |

Si el asistente no aparece, no es un error: no está habilitado para todos. Se anota «sin asistente» y se sigue.

## Verificación propia de cada carrera

Cada tester suma esto dentro de los pasos 3 y 5. La lista de qué se sabe de cada carrera está en `docs/beta/qa-carreras/` (rama `ronda/r5-c12-qa-carreras`) y los avisos inventados, en `packages/pipeline/test/fixtures/carreras/<carrera>.json`.

| Carrera | Qué mirar además |
| --- | --- |
| Abogacía y legales | Que las ofertas sean de estudios o áreas legales; que una oferta de otra disciplina no figure como compatible |
| Contaduría, impuestos y finanzas | Skills propias (Excel, Power BI, SQL, Tableau) en el paso 2; que el puntaje de un aviso contable no se frene por «disciplina distinta» |
| Administración de empresas | Que aparezcan skills de gestión y que un aviso de RR.HH. o atención al cliente no se descarte sin motivo |
| Comunicación y prensa | Que un aviso de prensa o contenidos llegue; que un aviso de marketing no se mezcle |
| Marketing | Skills propias (SEO y similares) en el paso 2; que un aviso de relaciones públicas no llegue acá por error |
| Relaciones públicas | Que el chip de `/acceso` y la carrera elegida sean «Relaciones públicas», no Marketing; que «community manager» y «social media manager» no desaparezcan (arreglo en #457) |
| Relaciones internacionales y comex | Que el requisito de una oferta no diga una disciplina técnica ajena (hallazgo P1 de C12: «ai engineer») |
| Programación | Que la ayuda no diga que no hace falta saber de programación (hallazgo P2 de C12); skills en el paso 2 |

> Nota para quien arma la lista de testers: la guía `ensayo-testers.md` habla de 6 carreras y el ensayo es de 8 (se sumaron Relaciones públicas como carrera propia y Programación). Si un tester es de una carrera que no está en su guía, usá este guion igual.

## Qué se entrega al terminar

La planilla de `docs/beta/ensayo-testers.md` §5 (una por tester) y, si algo falló, el comentario enviado con **«¿Algo no anduvo?»**. Cómo se juntan y se clasifican: `docs/beta/ensayo/feedback-y-triage.md`.
