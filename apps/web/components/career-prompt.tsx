"use client";

import { useActionState, useState } from "react";
import {
  dismissCareerPromptAction,
  saveCareerPromptAction,
  type CareerPromptState,
} from "@/app/(app)/career-actions";
import { Button } from "@/components/ui/button";

/**
 * Recuadro «¿Cuál es tu carrera?» (R32-01) para cuentas que no la cargaron. Va arriba del contenido de la pantalla
 * en la que está la persona: no redirige ni tapa nada, así no pierde lo que estaba haciendo. Se muestra una sola
 * vez (el servidor lo anota al guardar o al tocar «Ahora no»). Las ocho carreras de la beta y «Otra» con texto
 * libre; el servidor vuelve a validar todo. Los textos vienen de `ALTA_TEXTOS`.
 */

export type CareerPromptTexts = {
  titulo: string;
  texto: string;
  grupo: string;
  otra: string;
  otraLabel: string;
  otraAyuda: string;
  guardar: string;
  ahoraNo: string;
  guardada: string;
  errores: { elegir: string; corta: string; larga: string; caracteres: string; fallo: string };
};

const INITIAL: CareerPromptState = { status: "idle" };

const chipBox = "relative min-h-11 cursor-pointer items-center py-[3px] inline-flex group/chip";
const chipPill =
  "inline-flex items-center rounded-pill border-x-2 border-t-2 border-b-4 border-line-strong bg-surface px-3.5 py-2 text-[13px] leading-[1.2] font-bold text-fg group-hover/chip:bg-surface-muted group-has-[:checked]/chip:border-brand-contrast group-has-[:checked]/chip:bg-brand group-has-[:checked]/chip:text-brand-contrast group-has-[:focus-visible]/chip:outline group-has-[:focus-visible]/chip:outline-2 group-has-[:focus-visible]/chip:outline-offset-2 group-has-[:focus-visible]/chip:outline-focus";

export function CareerPrompt({
  careers,
  texts,
}: {
  careers: readonly { key: string; label: string }[];
  texts: CareerPromptTexts;
}) {
  const [state, action, pending] = useActionState(saveCareerPromptAction, INITIAL);
  const [choice, setChoice] = useState("");
  // Controlado: React vacía los campos no controlados cuando termina la acción, y un error no debe borrar lo escrito
  const [other, setOther] = useState("");
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  const error = state.status === "error" && !pending ? state : null;
  const careerMessage = error?.field === "career" ? texts.errores.elegir : null;
  const otherMessage =
    error?.field === "careerOther" ? texts.errores[error.reason ?? "corta"] : null;
  const failMessage = error?.field === "fallo" ? texts.errores.fallo : null;

  if (state.status === "done") {
    return (
      <p
        role="status"
        data-testid="carrera-pedida-guardada"
        className="mx-4 mb-4 rounded-card bg-success-soft px-4 py-3 text-sm font-semibold text-success sm:mx-0"
      >
        {texts.guardada}
      </p>
    );
  }

  return (
    <section
      aria-labelledby="carrera-pedida-titulo"
      data-testid="carrera-pedida"
      className="mb-5 rounded-card border-2 border-line-strong bg-surface p-4"
    >
      <h2 id="carrera-pedida-titulo" className="text-base font-bold text-fg">
        {texts.titulo}
      </h2>
      <p className="mt-1 text-sm text-fg-subtle">{texts.texto}</p>
      <form action={action} className="mt-3 flex flex-col gap-3">
        <fieldset
          className="flex flex-col gap-1"
          aria-describedby={careerMessage ? "carrera-pedida-error" : undefined}
        >
          <legend className="sr-only">{texts.grupo}</legend>
          <div className="flex flex-wrap gap-x-2">
            {careers.map((c) => (
              <label key={c.key} className={chipBox}>
                <input
                  type="radio"
                  name="career"
                  value={c.key}
                  checked={choice === c.key}
                  onChange={() => setChoice(c.key)}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
                <span className={chipPill}>{c.label}</span>
              </label>
            ))}
            <label className={chipBox}>
              <input
                type="radio"
                name="career"
                value="otra"
                checked={choice === "otra"}
                onChange={() => setChoice("otra")}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
              <span className={chipPill}>{texts.otra}</span>
            </label>
          </div>
          {careerMessage ? (
            <p id="carrera-pedida-error" role="alert" className="text-sm font-medium text-danger">
              {careerMessage}
            </p>
          ) : null}
        </fieldset>
        {choice === "otra" ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="carrera-pedida-otra" className="text-sm font-bold text-fg">
              {texts.otraLabel}
            </label>
            <input
              id="carrera-pedida-otra"
              name="careerOther"
              type="text"
              maxLength={60}
              autoComplete="off"
              required
              value={other}
              onChange={(e) => setOther(e.target.value)}
              aria-invalid={otherMessage ? true : undefined}
              aria-describedby={
                otherMessage ? "carrera-pedida-otra-error" : "carrera-pedida-otra-ayuda"
              }
              className="min-h-11 w-full rounded-control border-2 border-line-control bg-surface px-3 py-2 text-base text-fg focus-visible:border-focus aria-invalid:border-danger-strong"
            />
            <p id="carrera-pedida-otra-ayuda" className="text-xs text-fg-subtle">
              {texts.otraAyuda}
            </p>
            {otherMessage ? (
              <p
                id="carrera-pedida-otra-error"
                role="alert"
                className="text-sm font-medium text-danger"
              >
                {otherMessage}
              </p>
            ) : null}
          </div>
        ) : null}
        {failMessage ? (
          <p role="alert" className="text-sm font-medium text-danger">
            {failMessage}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" disabled={pending}>
            {texts.guardar}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              // Se esconde en el momento; el servidor anota que ya se pidió para no volver a mostrarlo
              setHidden(true);
              void dismissCareerPromptAction();
            }}
          >
            {texts.ahoraNo}
          </Button>
        </div>
      </form>
    </section>
  );
}
