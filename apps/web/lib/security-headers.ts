/** Headers de seguridad de todas las respuestas. La CSP global limita solo quién puede enmarcarnos. */
export const SECURITY_HEADERS: readonly { key: string; value: string }[] = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    // Sin interest-cohort: Chrome ya no lo reconoce y lo informa como error en la consola.
    // Micrófono solo para el propio sitio (R25): con `microphone=()` el navegador niega getUserMedia y el
    // dictado sin mostrar el cartel de permiso. Iframes y terceros siguen sin acceso.
    value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=()",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  // Sin preload ni includeSubDomains: esa decisión es difícil de deshacer
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];
