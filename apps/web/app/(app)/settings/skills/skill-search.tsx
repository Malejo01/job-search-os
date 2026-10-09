"use client";

import { useState } from "react";
import { SkillRow } from "./skill-row";

type Option = { slug: string; name: string; aliases: string[] };

function norm(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Buscador "Agregar otra skill": filtra la taxonomía por nombre y alias; al elegir una suma una
 * fila con los mismos radios. El campo de búsqueda no tiene `name`, no viaja en el formulario.
 */
export function SkillSearch({ options }: { options: Option[] }) {
  const [query, setQuery] = useState("");
  const [added, setAdded] = useState<string[]>([]);

  const q = norm(query.trim());
  const matches =
    q === ""
      ? []
      : options
          .filter((o) => !added.includes(o.slug))
          .filter((o) => norm(o.name).includes(q) || o.aliases.some((a) => norm(a).includes(q)))
          .slice(0, 8);

  return (
    <section className="flex flex-col gap-2" aria-labelledby="agregar-skill">
      <h2 id="agregar-skill" className="text-base font-medium">
        Agregar otra skill
      </h2>
      <label className="flex flex-col gap-1 text-sm">
        Buscar por nombre
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          // Enter no tiene que enviar el formulario
          onKeyDown={(e) => {
            if (e.key === "Enter") e.preventDefault();
          }}
          autoComplete="off"
          className="rounded-md border border-zinc-300 px-3 py-2 text-base"
        />
      </label>
      <div aria-live="polite">
        {q !== "" ? (
          matches.length > 0 ? (
            <ul className="flex flex-wrap gap-2" aria-label="Resultados">
              {matches.map((o) => (
                <li key={o.slug}>
                  <button
                    type="button"
                    onClick={() => {
                      setAdded((a) => [...a, o.slug]);
                      setQuery("");
                    }}
                    className="min-h-11 rounded-md border border-zinc-300 px-3 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900"
                  >
                    {o.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-600">No hay skills con ese nombre.</p>
          )
        ) : null}
      </div>
      {added.map((slug) => {
        const o = options.find((x) => x.slug === slug);
        return o ? <SkillRow key={slug} slug={slug} name={o.name} /> : null;
      })}
    </section>
  );
}
