# Panel · revisión transversal de seguridad y privacidad

Sesión de una persona sintética en la app local (modo desarrollo), con lectura cruzada contra ofertas e ítems de otras personas sintéticas. Según la regla de hallazgos abiertos (D-026), lo que sigue abierto se describe en forma neutra; el detalle está en las notas privadas de la ronda.

**Veredicto:** no hay lectura cruzada ni datos ajenos expuestos. Hay 2 hallazgos importantes y varios pulidos.

## Hallazgos abiertos
1. **Importante · Validación de URLs en el alta manual de ofertas.** El servidor tiene que aceptar solo enlaces `http` y `https` y no guardar credenciales embebidas. Hoy la única defensa es la del framework al renderizar. Con test, en el alta manual y en las otras ingestas.
2. **Importante · Un aspecto de la misma validación,** con el mismo arreglo.
3. **Pulido · Ids con formato inválido en las rutas de detalle y en algunas acciones:** dan 500 en vez de 404. Validar el formato y responder `notFound()` antes de consultar.
4. **Pulido · Los campos numéricos del alta manual se validan solo en el navegador.** Sumar validación en el servidor con rangos.
5. **Pulido · "Candidatos a skill nueva"** cuenta apariciones y no ofertas, y tiene ruido ("PTO", "hrs").
6. **Pulido · Códigos internos (`location_risk`) a la vista.**
7. **Pulido · El link "Invitaciones" se ve para quien no es admin.** La acción está bien bloqueada en el servidor.

## Lo que se comprobó que está bien
- **Lectura cruzada:** las ofertas de otra persona dan 404 limpio y no hay subrutas con datos. Sin sesión, las pantallas y las APIs redirigen a `/login` o dan 401.
- **Ítems ajenos del plan:** no hay URL que los use, y el cambio de estado filtra por `id` y `user_id`, además de RLS (por código).
- **Parámetros de URL hostiles:** se ignoran o dan un mensaje genérico. Ningún valor se refleja; no hay XSS.
- **HTML, `<script>`, emojis e inyección SQL** en títulos, empresas y JDs: se muestran literales.
- **Datos expuestos:**
  - cada persona ve solo su email, su dirección de ingesta y sus postulaciones;
  - los candidatos de `/market` salen con `withUser` y con caché por usuario.
- **Invitaciones:** se bloquean en el servidor para quien no es admin.
- **Niveles de skills:** se validan con Zod en el servidor, y el error lleva solo el nombre del campo.
- **Sesión:** "Salir" y "Atrás" llevan a `/login`; `/api/health` no expone datos.

## No probado
- Editar el resumen del perfil (no hay pantalla).
- Los errores en un build de producción.
- Manipular campos ocultos de Server Actions.
