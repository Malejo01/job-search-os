"use client";

import { usePathname, useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import { saveCvLinksAction, type CvLinksState } from "@/app/(app)/cv/links-actions";
import { buttonClasses, cardClasses, inputClasses } from "@/components/ui";
import { CV_LINK_KEYS, cvOptionsQuery, type CvLinkKey } from "@/lib/cv-options-query";
import type { CvOptions } from "@/lib/cv-source";
import { CV_DOCUMENTO_TEXTOS } from "@/lib/textos-rediseno";

const O = CV_DOCUMENTO_TEXTOS.opciones;
const L = CV_DOCUMENTO_TEXTOS.links;
const IDLE: CvLinksState = { status: "idle", errors: {} };

/** `https://…` completa y sin espacios: lo mínimo para ofrecer «Abrir para probarlo» (la validación real es del servidor). */
const OPENABLE_RE = /^https:\/\/[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?:[/?#]\S*)?$/;

/**
 * Opciones del CV y links (R33-07, C-43 a C-45). Cada cambio actualiza la vista previa sola (sin botón
 * «Actualizar»): reemplaza la consulta de la URL y la página del servidor se vuelve a armar. Ciudad y país
 * vienen marcados («no tu dirección»); los links cargados, también. El teléfono es opcional y viene sin
 * marcar; en la URL solo viaja la marca, nunca el número.
 * Los links se guardan con una acción del servidor que solo acepta `https`.
 */
export function CvOpciones({
  opts,
  links,
}: {
  opts: CvOptions;
  /** Lo ya guardado (links, etiqueta del otro link y teléfono), sin filtrar. */
  links: Partial<Record<CvLinkKey | "otroEtiqueta" | "telefono", string>>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [updating, startTransition] = useTransition();
  const [state, setState] = useState(opts);
  const [saved, action, saving] = useActionState(
    async (_prev: CvLinksState, formData: FormData) => {
      const result = await saveCvLinksAction(_prev, formData);
      if (result.status === "saved") router.refresh();
      return result;
    },
    IDLE,
  );
  const [typed, setTyped] = useState<Record<CvLinkKey, string>>({
    linkedin: links.linkedin ?? "",
    github: links.github ?? "",
    portfolio: links.portfolio ?? "",
    otro: links.otro ?? "",
  });
  const [typedLabel, setTypedLabel] = useState(links.otroEtiqueta ?? "");
  const [typedPhone, setTypedPhone] = useState(links.telefono ?? "");

  function change(next: CvOptions) {
    setState(next);
    startTransition(() => {
      router.replace(`${pathname}?${cvOptionsQuery(next)}`, { scroll: false });
    });
  }

  return (
    <div className="no-print flex flex-col gap-3" data-testid="cv-opciones">
      <section
        aria-label={O.titulo}
        className={cardClasses({
          padding: "md",
          className: "flex flex-wrap items-end gap-x-6 gap-y-3",
        })}
      >
        <label className="flex flex-col gap-1.5 text-sm font-medium text-fg">
          {O.idioma}
          <select
            value={state.lang}
            onChange={(e) => change({ ...state, lang: e.target.value === "en" ? "en" : "es" })}
            className={inputClasses()}
          >
            <option value="es">Español</option>
            <option value="en">English</option>
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm text-fg">
          <input
            type="checkbox"
            checked={state.includeEmail}
            onChange={(e) => change({ ...state, includeEmail: e.target.checked })}
          />
          {O.email}
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm text-fg">
          <input
            type="checkbox"
            checked={state.includeBasics}
            onChange={(e) => change({ ...state, includeBasics: e.target.checked })}
          />
          {O.basicas}
        </label>
        <label className="flex min-h-11 flex-col justify-center gap-0.5 text-sm text-fg">
          <span className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={state.includePlace !== false}
              aria-describedby="cv-lugar-ayuda"
              onChange={(e) => change({ ...state, includePlace: e.target.checked })}
            />
            {O.lugar}
          </span>
          <span id="cv-lugar-ayuda" className="text-sm text-fg-muted">
            {O.lugarAyuda}
          </span>
        </label>
        {CV_LINK_KEYS.filter((k) => links[k]).map((k) => (
          <label key={k} className="flex min-h-11 items-center gap-2 text-sm text-fg">
            <input
              type="checkbox"
              checked={state.includeLinks?.[k] !== false}
              onChange={(e) =>
                change({
                  ...state,
                  includeLinks: {
                    linkedin: state.includeLinks?.linkedin !== false,
                    github: state.includeLinks?.github !== false,
                    portfolio: state.includeLinks?.portfolio !== false,
                    otro: state.includeLinks?.otro !== false,
                    [k]: e.target.checked,
                  },
                })
              }
            />
            {O.incluirLink[k]}
          </label>
        ))}
        {links.telefono ? (
          <label className="flex min-h-11 flex-col justify-center gap-0.5 text-sm text-fg">
            <span className="flex items-center gap-2">
              <input
                type="checkbox"
                data-testid="cv-incluir-telefono"
                checked={state.includePhone === true}
                aria-describedby="cv-telefono-ayuda"
                onChange={(e) => change({ ...state, includePhone: e.target.checked })}
              />
              {O.telefono}
            </span>
            <span id="cv-telefono-ayuda" className="text-sm text-fg-muted">
              {O.telefonoAyuda}
            </span>
          </label>
        ) : null}
        <span role="status" aria-live="polite" className="text-sm text-fg-muted">
          {updating ? O.actualizando : ""}
        </span>
      </section>

      <form
        action={action}
        aria-label={L.titulo}
        data-testid="cv-links"
        className={cardClasses({ padding: "md", className: "flex flex-col gap-3" })}
      >
        <h2 className="text-base font-bold text-fg">{L.titulo}</h2>
        <p className="text-sm text-fg-muted">{L.ayuda}</p>
        {CV_LINK_KEYS.map((k) => {
          const error = saved.errors[k];
          const value = typed[k].trim();
          return (
            <div key={k} className="flex flex-col gap-1.5">
              <label className="flex flex-col gap-1.5 text-sm font-medium text-fg">
                {L.campo[k]}
                <input
                  type="text"
                  name={k}
                  value={typed[k]}
                  inputMode="url"
                  autoComplete="off"
                  placeholder="https://"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? `cv-link-${k}-error` : undefined}
                  onChange={(e) => setTyped({ ...typed, [k]: e.target.value })}
                  className={inputClasses()}
                />
              </label>
              {OPENABLE_RE.test(value) ? (
                <a
                  href={value}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center self-start text-sm font-semibold underline underline-offset-2"
                >
                  {L.abrir}
                  <span className="sr-only"> ({L.campo[k]}, se abre en otra pestaña)</span>
                </a>
              ) : null}
              {error ? (
                <p id={`cv-link-${k}-error`} role="alert" className="text-sm text-danger">
                  {error}
                </p>
              ) : null}
            </div>
          );
        })}
        <div className="flex flex-col gap-1.5">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-fg">
            {L.otroEtiqueta}
            <input
              type="text"
              name="otroEtiqueta"
              value={typedLabel}
              maxLength={30}
              autoComplete="off"
              aria-invalid={saved.errors.otroEtiqueta ? true : undefined}
              aria-describedby={saved.errors.otroEtiqueta ? "cv-otro-etiqueta-error" : undefined}
              onChange={(e) => setTypedLabel(e.target.value)}
              className={inputClasses()}
            />
          </label>
          {saved.errors.otroEtiqueta ? (
            <p id="cv-otro-etiqueta-error" role="alert" className="text-sm text-danger">
              {saved.errors.otroEtiqueta}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-fg">
            {L.telefono}
            <input
              type="tel"
              name="telefono"
              value={typedPhone}
              maxLength={25}
              inputMode="tel"
              autoComplete="off"
              aria-describedby="cv-telefono-campo-ayuda"
              aria-invalid={saved.errors.telefono ? true : undefined}
              onChange={(e) => setTypedPhone(e.target.value)}
              className={inputClasses()}
            />
          </label>
          <span id="cv-telefono-campo-ayuda" className="text-sm text-fg-muted">
            {L.telefonoAyuda}
          </span>
          {saved.errors.telefono ? (
            <p role="alert" className="text-sm text-danger">
              {saved.errors.telefono}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className={buttonClasses({ variant: "secondary" })}
          >
            {saving ? L.guardando : L.guardar}
          </button>
          <span role="status" aria-live="polite" className="text-sm text-fg-muted">
            {saved.status === "saved" ? L.guardado : ""}
          </span>
        </div>
      </form>
    </div>
  );
}
