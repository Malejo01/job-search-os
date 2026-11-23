"use client";

import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { buttonClasses, cardClasses, inputClasses, labelClasses } from "@/components/ui";
import { searchFichas } from "@/lib/academy-lectura";

export type AcademyItem = { slug: string; titulo: string; bajada: string; minutos: number };

/** Lista de fichas con buscador sobre títulos y bajadas. Todo en el cliente: las fichas ya vienen cargadas. */
export function AcademyBuscador({
  items,
  sinResultados,
  accionLimpiar,
}: {
  items: AcademyItem[];
  /** Estado vacío de la marca, armado en el servidor (R23-07): no se importa acá para no sumar JS. */
  sinResultados: ReactNode;
  accionLimpiar: string;
}) {
  const [query, setQuery] = useState("");
  const id = useId();
  const visibles = searchFichas(items, query);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className={labelClasses()}>
          Buscar una ficha
        </label>
        <input
          id={id}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
          placeholder="Por ejemplo: inglés, CV, entrevista"
          data-testid="academy-buscador"
          className={inputClasses()}
        />
      </div>
      <p className="m-0 text-sm text-fg-muted" role="status" data-testid="academy-resultados">
        {visibles.length === 1 ? "1 ficha" : `${visibles.length} fichas`}
      </p>
      {visibles.length === 0 ? (
        <div className="flex flex-col items-center gap-3" data-testid="academy-sin-resultados">
          {sinResultados}
          <button
            type="button"
            onClick={() => setQuery("")}
            className={buttonClasses({ variant: "secondary" })}
          >
            {accionLimpiar}
          </button>
        </div>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="academy-lista">
          {visibles.map((f) => (
            <li key={f.slug}>
              <Link
                href={`/academy/${f.slug}`}
                className={`${cardClasses()} flex min-h-12 items-center justify-between gap-3 text-fg hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus`}
              >
                <span className="flex flex-col gap-0.5">
                  <span className="font-bold">{f.titulo}</span>
                  {f.bajada ? <span className="text-sm text-fg-muted">{f.bajada}</span> : null}
                  <span className="text-xs text-fg-subtle">{f.minutos} min de lectura</span>
                </span>
                <span aria-hidden="true" className="text-lg text-fg-subtle">
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
