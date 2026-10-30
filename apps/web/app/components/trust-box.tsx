import { fillTrustBody, TRUST_TEXTS } from "@job-search-os/pipeline";
import Link from "next/link";
import { getTrustResponsable } from "@/lib/trust";

/** Cookie de «Entiendo y continúo» del modal de privacidad del asistente: solo UX (httpOnly, un año). */
export const PRIVACY_OK_COOKIE = "jso_privacidad_ok";
export const PRIVACY_OK_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Recuadro de confianza: qué leemos, qué no, cómo cortarlo y quién está detrás. Server Component:
 * el responsable se lee de la variable de entorno en cada request, por eso las páginas que lo
 * muestran son dinámicas.
 */
export function TrustBox({ className = "" }: { className?: string }) {
  const responsable = getTrustResponsable();
  return (
    <aside
      aria-labelledby="trust-box-title"
      data-testid="trust-box"
      className={`rounded-control border border-line bg-surface-subtle px-3 py-3 text-sm text-fg-muted ${className}`.trim()}
    >
      <h2 id="trust-box-title" className="text-base font-semibold text-fg">
        Tu privacidad, en pocas palabras
      </h2>
      <dl className="mt-2 flex flex-col gap-2">
        {TRUST_TEXTS.map((t) => (
          <div key={t.id}>
            <dt className="font-medium text-fg">{t.title}</dt>
            <dd>
              {fillTrustBody(t.body, responsable)}
              {t.id === "responsable" ? (
                <>
                  {" "}
                  <Link
                    href="/legal/privacidad"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    Leer la política de privacidad
                  </Link>
                  .
                </>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
