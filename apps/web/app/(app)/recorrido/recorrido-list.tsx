"use client";

import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";
import { buttonClasses, cardClasses, textLinkClasses } from "@/components/ui";
import { openFeedbackForScreen } from "@/lib/feedback-screen";
import { primerUsoKey } from "@/lib/primer-uso";
import { resetPrimerUsoAction } from "@/lib/primer-uso-actions";
import {
  parseReviewed,
  recorridoKey,
  RECORRIDO_GROUPS,
  type RecorridoScreen,
} from "@/lib/recorrido";
import { RECORRIDO_TEXTOS as T } from "@/lib/textos-recorrido";

/** Una pantalla ya resuelta en el servidor: adónde lleva «Abrir» y si hay que explicar cómo llegar. */
export type RecorridoItem = RecorridoScreen & {
  href: string;
  /** Mostrar `howTo` bajo la pantalla (falta algo para abrirla, o siempre hay una aclaración). */
  showHowTo: boolean;
};

// Lo revisado vive en `localStorage`, leído como una fuente externa (`useSyncExternalStore`): en el servidor y
// en la hidratación no hay nada (`null`), en el cliente se lee el texto guardado. Si el navegador no deja
// guardar (modo privado, almacenamiento lleno), el avance se mantiene en memoria mientras la página siga abierta.
const listeners = new Set<() => void>();
let memory: string | null = null;
let storageFailed = false;

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function readRaw(key: string): string {
  if (memory !== null) return memory;
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    storageFailed = true;
    return "";
  }
}

function writeRaw(key: string, value: string): void {
  memory = value;
  try {
    window.localStorage.setItem(key, value);
    memory = null;
  } catch {
    storageFailed = true;
  }
  listeners.forEach((l) => l());
}

/**
 * La lista del recorrido (R26-03). Client Component por tres cosas: el progreso («Revisaste N de M») que
 * queda en `localStorage` de este navegador (con try/catch: sin almacenamiento sigue andando, sin guardar),
 * «Comentar esta pantalla» (abre el feedback con la pantalla elegida) y «Abrir» del primer uso. Sin
 * animaciones. No recibe datos de la persona más que su id (para la clave del almacenamiento).
 */
export function RecorridoList({ userId, items }: { userId: string; items: RecorridoItem[] }) {
  const key = recorridoKey(userId);
  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(key),
    () => null,
  );
  const ready = raw !== null;
  const reviewed = useMemo(() => parseReviewed(raw), [raw]);
  const storage = !storageFailed;

  function save(next: string[]) {
    writeRaw(key, JSON.stringify(next));
  }

  function toggle(id: string) {
    save(reviewed.includes(id) ? reviewed.filter((x) => x !== id) : [...reviewed, id]);
  }

  /**
   * El primer uso se muestra mientras no figure como visto ni en el navegador ni en la cuenta
   * (`profiles.primer_uso_visto`, R26-05): se borran las dos marcas y recién después se navega.
   */
  async function openPrimerUso(href: string) {
    try {
      window.localStorage.removeItem(primerUsoKey(userId));
    } catch {
      // Sin almacenamiento el recorrido se ve igual en cada visita
    }
    await resetPrimerUsoAction().catch(() => false);
    // Navegación completa a propósito: el diálogo vive en el layout, que no se vuelve a leer en una navegación suave
    window.location.assign(href);
  }

  const done = items.filter((i) => reviewed.includes(i.id)).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <p
          role="status"
          aria-live="polite"
          data-testid="recorrido-progreso"
          className="text-base font-bold text-fg"
        >
          {ready ? T.progress(done, items.length) : " "}
        </p>
        {done > 0 ? (
          <button
            type="button"
            onClick={() => save([])}
            className={textLinkClasses({ block: true, className: "text-sm" })}
          >
            {T.resetProgress}
          </button>
        ) : null}
      </div>
      {!storage ? (
        <p role="note" className="text-sm text-fg-muted">
          {T.noStorage}
        </p>
      ) : null}

      {RECORRIDO_GROUPS.map((g) => {
        const inGroup = items.filter((i) => i.group === g.id);
        if (inGroup.length === 0) return null;
        return (
          <section
            key={g.id}
            aria-labelledby={`recorrido-${g.id}`}
            data-testid={`recorrido-grupo-${g.id}`}
            className="flex flex-col gap-3"
          >
            <h2 id={`recorrido-${g.id}`} className="text-heading font-bold">
              {g.label}
            </h2>
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {inGroup.map((item) => (
                <li
                  key={item.id}
                  data-testid={`recorrido-${item.id}`}
                  className={cardClasses({
                    level: "list",
                    padding: "md",
                    className: "flex flex-col gap-3",
                  })}
                >
                  <div className="flex flex-col gap-1">
                    <h3 className="text-base font-bold text-fg">{item.title}</h3>
                    <p className="text-sm text-fg-muted">{item.what}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold tracking-wide text-fg-subtle uppercase">
                      {T.look}
                    </p>
                    <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-sm text-fg">
                      {item.look.map((l) => (
                        <li key={l}>{l}</li>
                      ))}
                    </ul>
                  </div>
                  {item.showHowTo && item.howTo ? (
                    <p data-testid="recorrido-como-llegar" className="text-sm text-fg-muted">
                      {item.howTo}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-3">
                    {item.open.kind === "primer-uso" ? (
                      <button
                        type="button"
                        onClick={() => openPrimerUso(item.href)}
                        className={buttonClasses({ size: "sm" })}
                      >
                        {T.open}
                        <span className="sr-only"> {item.title}</span>
                      </button>
                    ) : (
                      <Link href={item.href} className={buttonClasses({ size: "sm" })}>
                        {T.open}
                        <span className="sr-only"> {item.title}</span>
                      </Link>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        openFeedbackForScreen({ screen: item.route, label: item.title })
                      }
                      className={buttonClasses({ variant: "secondary", size: "sm" })}
                    >
                      {T.comment}
                      <span className="sr-only">: {item.title}</span>
                    </button>
                    <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={reviewed.includes(item.id)}
                        onChange={() => toggle(item.id)}
                        className="size-5"
                      />
                      <span>
                        {T.reviewed}
                        <span className="sr-only">: {item.title}</span>
                      </span>
                    </label>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
