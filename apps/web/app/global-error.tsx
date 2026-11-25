"use client";

import { BRAND_COLORS } from "@job-search-os/pipeline";
import { mascotaAncho, mascotaSrc } from "@/lib/mascota";

// Reemplaza al layout raíz: sin Tailwind ni componentes compartidos, porque el layout puede ser lo que falló.
// Sin el layout tampoco hay `globals.css`: los estilos van en un <style> propio (R28-01), así entran las
// reglas que el estilo en línea no puede expresar (`prefers-color-scheme`, foco visible).
// Claro: texto índigo sobre lavanda (contraste > 12:1); secundario Zinc 600 sobre lavanda (6,9:1).
// Oscuro (según el sistema): texto #F4F4FA y secundario #C7C6E6 sobre #14123A (> 11:1 y 9:1).
const CSS = `
.ge-body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:${BRAND_COLORS.ink};background:${BRAND_COLORS.canvas};color-scheme:light dark}
.ge-main{max-width:448px;margin:0 auto;padding:64px 16px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:16px}
.ge-afi{width:176px;height:176px;border-radius:50%;background:${BRAND_COLORS.canvas};display:flex;align-items:flex-end;justify-content:center}
.ge-afi img{display:block;height:100%;width:auto;max-width:none}
.ge-h1{font-size:24px;font-weight:800;margin:0}
.ge-muted{font-size:14px;color:${BRAND_COLORS.textMuted};margin:0}
.ge-code{font-size:12px;color:${BRAND_COLORS.textMuted};margin:0}
.ge-btn{min-height:44px;min-width:44px;padding:8px 24px;border:0;border-bottom:6px solid ${BRAND_COLORS.accentEdge};border-radius:9999px;background:${BRAND_COLORS.accent};color:${BRAND_COLORS.ink};font-size:15px;font-weight:800;cursor:pointer}
.ge-btn:focus-visible{outline:3px solid ${BRAND_COLORS.accentDeep};outline-offset:3px}
@media (prefers-color-scheme: dark){
.ge-body{color:#F4F4FA;background:#14123A}
.ge-afi{background:#14123A}
.ge-muted,.ge-code{color:${BRAND_COLORS.onInkMuted}}
.ge-btn:focus-visible{outline-color:${BRAND_COLORS.accent}}
}
`;

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="es">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Algo falló de nuestro lado</title>
        <style>{CSS}</style>
      </head>
      <body className="ge-body">
        <main id="contenido" className="ge-main">
          {/* R27-05: la mascota `analizando` sobre el círculo lavanda; decorativa (el título dice todo) */}
          <div aria-hidden="true" className="ge-afi">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              {...mascotaSrc("analizando")}
              sizes={`${mascotaAncho("analizando", 176)}px`}
              width={mascotaAncho("analizando", 176)}
              height={176}
              alt=""
              draggable={false}
            />
          </div>
          <h1 className="ge-h1">Algo falló de nuestro lado</h1>
          <p className="ge-muted">Probá de nuevo. Si sigue pasando, avisanos.</p>
          <div>
            <button type="button" onClick={() => reset()} className="ge-btn">
              Probar de nuevo
            </button>
          </div>
          {/* Nunca error.message: puede citar datos. */}
          {error.digest ? <p className="ge-code">Código: {error.digest}</p> : null}
        </main>
      </body>
    </html>
  );
}
