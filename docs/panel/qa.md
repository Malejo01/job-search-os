# Panel · `qa`: QA con 4 años, manual y algo de automatización

Persona sintética (ficha en `fichas.md`). Recorrido en la app local con datos ficticios y el LLM en modo demo. Lente: probar como QA, con casos de borde. Las capturas no se versionan; los números entre paréntesis las nombran.

## Resumen
- Hizo todo solo (registro, perfil, skills, 4 JDs, mercado, plan y ajustes) en unos 12 minutos, más los casos de borde.
- No le sirvió para su objetivo:
  - sus 3 ofertas de QA salieron descartadas o bloqueadas por "disciplina distinta";
  - el mercado le recomienda ETL, Snowflake y AWS;
  - el catálogo no tiene Playwright ni Postman.
- **Casos de borde que no rompen nada ni inyectan HTML:** JD vacía, JD de unos 250 KB, emojis, `<b>`, `<script>`, acentos, `%`.
- **Errores nuevos:** 500 con un id inválido, doble clic en el registro y datos que se pierden cuando falla un formulario.
- **Ya reportados, vistos de nuevo:** disciplina, solo remoto, jerga, menú cortado, mercado sin foco, pre-score y perfil sin edición.

## Hallazgos

### 1. Bloqueante · Las híbridas se descartan aunque se desmarque "solo remoto"
- **Pantalla:** `/jobs/new` y detalle (`16`).
- **Pasos:** onboarding con "Busco solo trabajo remoto" **desmarcado**; cargar una oferta híbrida en su ciudad.
- **Resultado:** "Descartada (prefiltro)" con el motivo `modalidad_no_remota: modalidad hibrido`, sin evaluación y sin forma de forzarla.
- **Causa (verificada por el lead):** `packages/pipeline/src/prefilter/prefilter.ts:183` descarta híbrido y presencial siempre. El prefiltro no lee `profiles.remote_only`, así que el casillero del onboarding no cambia nada.
- **Arreglo:** que el prefiltro use el flag del perfil (o un criterio editable), o que el onboarding diga que solo se evalúan ofertas remotas.

### 2. Bloqueante · Bloqueadores que contradicen el informe
- **Pantalla:** detalle de "QA Engineer, Observability and CI/CD" (`30`, `18`).
- **Qué pasó:** el bloqueador dice "años en otro dominio (QA experience)", y el match fuerte, "4 años de experiencia (pide 3+)". El veredicto dice "Buen match técnico… bloqueado porque la disciplina QA no entra en las permitidas" y la acción es "Descartar". El bloqueador repite palabras de la JD en vez de explicar.
- **Arreglo:** no mostrar como bloqueador un motivo que contradice el match; validar la coherencia con los años del perfil.

### 3. Importante · Falso gap cuando la JD pide "A o B"
- **Pantalla:** pre-evaluación de "Test automation in TypeScript or Python" (`29`).
- **Qué pasó:** con Python en nivel 2, "Te faltan" lista TypeScript.
- **Arreglo:** agrupar las alternativas en la pre-evaluación.

### 4. Importante · Gaps que ignoran las skills cargadas
- **Pantalla:** detalle de "QA Analyst (Manual + API)" (`18`).
- **Qué pasó:** "Consultas SQL básicas (must)" figura como gap con SQL cargado en nivel 2. El evaluador parece leer solo el resumen.
- **Arreglo:** pasarle al evaluador las skills con nivel, o aclarar de dónde sale cada gap.

### 5. Importante · Salario de fábrica que el usuario no cargó, y mínimo mayor que máximo
- **Pantalla:** `/jobs/new` (`19`).
- **Qué pasó:** el riesgo "salario máximo 100 por debajo de 3000" usa el valor de fábrica de los criterios. Además, el formulario acepta un mínimo mayor que el máximo.
- **Arreglo:** validar mínimo ≤ máximo; no comparar si el usuario no cargó un mínimo, o decir de dónde sale.

### 6. Importante · Doble clic en "Crear cuenta" muestra un error falso
- **Pantalla:** `/register?code=…` (`03`).
- **Qué pasó:** vuelve al registro vacío con "invitación inválida o vencida", pero la cuenta sí se creó: el primer clic consume la invitación. Un usuario real cree que no se registró.
- **Arreglo:** deshabilitar el botón mientras envía (`useFormStatus`); si la cuenta ya existe con esa invitación, ir al login.

### 7. Importante · Los formularios borran lo escrito al fallar
- **Qué pasó:**
  - en el registro, con contraseñas distintas vuelve todo vacío, incluida la casilla de términos (`02`);
  - en el login, con contraseña errónea se borra el email (`32`).
- **Arreglo:** conservar los valores (`useActionState` o parámetros).

### 8. Importante · Doble clic en "Cargar oferta" duplica la fuente
- **Pantalla:** `/jobs/new` → `?nueva=merged` (`16`).
- **Qué pasó:** la oferta no se duplica, pero la fuente aparece dos veces ("Manual · manual").
- **Arreglo:** deshabilitar el botón mientras envía; no agregar una fuente idéntica.

### 9. Importante · Un id malformado en la URL da 500
- **Qué pasó:** `/jobs/no-es-un-uuid` da HTTP 500 (falla el cast a uuid en la consulta). Un uuid válido que no existe da 404 (`22`, `21`).
- **Arreglo:** validar el id con Zod y `notFound()` antes de consultar.

### 10. Importante · El 404 está en inglés y no ofrece salida
- **Qué pasó:** "404 This page could not be found.", sin link a Ofertas.
- **Arreglo:** `app/(app)/not-found.tsx` en español con link a `/jobs`.

### 11. Importante · El catálogo de QA no tiene Playwright, Postman, Jira ni Git
- **Pantalla:** búsqueda en skills (`09`).
- **Qué pasó:** son las herramientas de su resumen y de 3 de sus 5 JDs. (La búsqueda sí ignora mayúsculas y acentos.)
- **Arreglo:** sumar Playwright, Postman, Jira y Selenium/Cypress al rol QA; link "sugerir una skill" cuando no hay resultados.

### 12. Importante · Mercado y plan de QA armados con ofertas de datos y desarrollo
- **Pantalla:** `/market` y `/plan` (`23`, `24`).
- **Qué pasó:**
  - ninguna de las ofertas de la fuente es de QA;
  - testing (nivel 3) aparece como diferencial con "1 de 1 avisos";
  - el plan tiene 27 skills y unas 491 h, con "~0 h" y "sin recurso aprobado".
- **Arreglo:** decir en pantalla cuando no hay avisos del rol.

### 13. Importante · La validación del onboarding es solo la nativa del navegador
- **Qué pasó:** con un resumen corto o años = −3, aparece solo el globo del navegador; en el celular desaparece solo (`05`, `06`).
- **Arreglo:** mensaje en la página con `aria-live` y un contador.

### 14. Pulido · "Eliminar mi cuenta" pegado a "Guardar y continuar" en el onboarding
- **Arreglo:** separarlo, con otro color y confirmación.

### 15. Pulido · Lista de ofertas
- **Qué pasó:** todas las de la fuente se ven iguales, en "Evaluando…", y el chip `location_risk` sale crudo (`13`, `27`).

### 16. Pulido · Teclado
- **Qué pasó:** el foco se ve bien, pero no hay "saltar al contenido" y "Salir" cierra sesión sin confirmar (`28`).

### 17. Pulido · Mis skills
- **Qué pasó:** el aviso de guardado queda arriba, lejos del botón, y el rol no se recuerda (`25`, `26`).

### 18. Pulido · El asistente asume Gmail

## Lo que funcionó bien
1. Registro, login y "Salir". El login acepta mayúsculas y espacios en el email, y "Atrás" después de "Salir" no muestra datos de la sesión.
2. `<b>`, `<script>`, emojis, tildes y `%`: nada se inyecta ni rompe. La búsqueda ignora mayúsculas y acentos.
3. Una JD de unos 250 KB se acepta y se evalúa. La JD vacía queda "Pendiente de JD" con link para pegarla.
4. La evaluación se actualiza sola, y un cambio de nivel llegó a `/market` en menos de 15 s.
5. El detalle separa bien bloqueadores, riesgos, match y gaps, y avisa "Nada se envía desde acá".

## Top 3 por impacto y esfuerzo (según la persona)
1. Deshabilitar los botones mientras envían (resuelve el 6 y el 8).
2. Validar el id y un `not-found` en español (el 9 y el 10).
3. Playwright, Postman y Jira en el catálogo, y conservar los datos al fallar (el 11 y el 7).
