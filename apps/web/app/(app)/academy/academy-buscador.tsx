"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { cardClasses, inputClasses, labelClasses } from "@/components/ui";
import { searchFichas } from "@/lib/academy-lectura";

export type AcademyItem = { slug: string; titulo: string; bajada: string; minutos: number };

/** Lista de fichas con buscador sobre títulos y bajadas. Todo en el cliente: las fichas ya vienen cargadas. */
export function AcademyBuscador({ items }: { items: AcademyItem[] }) {
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
        <p className={cardClasses()} data-testid="academy-sin-resultados">
          No encontramos fichas con esa búsqueda. Probá con otra palabra.
        </p>
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
