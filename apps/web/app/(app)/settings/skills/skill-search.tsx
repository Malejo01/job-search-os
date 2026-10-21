"use client";

import {
  MAX_CUSTOM_SKILLS,
  customSkillKey,
  customSkillRejectionText,
  validateCustomSkillName,
} from "@job-search-os/pipeline";
import { useEffect, useRef, useState } from "react";
import { SkillInfo } from "@/components/skill-info";
import { SkillRow } from "./skill-row";

type Option = { slug: string; name: string; aliases: string[]; description: string | null };

function norm(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Buscador "Agregar otra skill": filtra la taxonomía por nombre y alias; al elegir una suma una
 * fila con los mismos radios. Si no hay nada con ese nombre, ofrece agregarlo como skill propia
 * («Agregar», o Enter en el buscador): el nombre se valida acá con las mismas reglas del servidor,
 * se suma una fila con su nivel y viaja como `new_name:<k>` + `new_level:<k>`.
 *
 * Las skills propias NO van a la taxonomía global ni a ningún prompt (ronda 78): se guardan en
 * `user_skills` solo para la persona. El campo de búsqueda no tiene `name`, no viaja en el formulario.
 */
export function SkillSearch({
  options,
  taxonomy,
  customNames,
}: {
  /** Skills de la taxonomía que todavía no tienen fila en la pantalla. */
  options: Option[];
  /** Toda la taxonomía (nombre y alias), para rechazar una propia que ya existe. */
  taxonomy: { slug: string; name: string; aliases: string[] }[];
  /** Nombres de las propias ya guardadas. */
  customNames: string[];
}) {
  const [query, setQuery] = useState("");
  const [added, setAdded] = useState<string[]>([]);
  const [pending, setPending] = useState<{ key: string; name: string }[]>([]);
  const [addError, setAddError] = useState<string | null>(null);
  const counter = useRef(0);
  const searchInput = useRef<HTMLInputElement>(null);
  // Fila recién agregada: el foco va a su primer radio y un `role="status"` siempre montado lo anuncia
  const [announce, setAnnounce] = useState<{ radioId: string; message: string } | null>(null);

  useEffect(() => {
    if (announce) document.getElementById(announce.radioId)?.focus();
  }, [announce]);

  const q = norm(query.trim());
  const matches =
    q === ""
      ? []
      : options
          .filter((o) => !added.includes(o.slug))
          .filter((o) => norm(o.name).includes(q) || o.aliases.some((a) => norm(a).includes(q)))
          .slice(0, 8);

  // Después de guardar, la propia ya viene en «Tus skills agregadas»: su fila nueva sobra
  const savedKeys = new Set(customNames.map(customSkillKey));
  const livePending = pending.filter((p) => !savedKeys.has(customSkillKey(p.name)));
  const noMatch = q !== "" && matches.length === 0;

  function addCustom() {
    const check = validateCustomSkillName(query, taxonomy);
    if (!check.ok) {
      setAddError(customSkillRejectionText(check));
      return;
    }
    if (savedKeys.has(check.key) || livePending.some((p) => customSkillKey(p.name) === check.key)) {
      setAddError("Ya agregaste esa skill.");
      return;
    }
    if (customNames.length + livePending.length >= MAX_CUSTOM_SKILLS) {
      setAddError(`Llegaste al máximo de ${MAX_CUSTOM_SKILLS} skills agregadas por vos.`);
      return;
    }
    counter.current += 1;
    const key = `n${counter.current}`;
    setPending((list) => [...list, { key, name: check.name }]);
    setAnnounce({
      radioId: `nueva-${key}-0`,
      message: `${check.name} agregada, elegí tu nivel`,
    });
    setQuery("");
    setAddError(null);
  }

  return (
    <section className="flex flex-col gap-2" aria-labelledby="agregar-skill">
      <h2 id="agregar-skill" className="text-base font-medium">
        Agregar otra skill
      </h2>
      <label className="flex flex-col gap-1 text-sm">
        Buscar por nombre
        <input
          ref={searchInput}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setAddError(null);
          }}
          // Enter no tiene que enviar el formulario; si no hay coincidencias, agrega la propia
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (noMatch) addCustom();
          }}
          autoComplete="off"
          aria-invalid={addError ? true : undefined}
          aria-describedby={addError ? "agregar-error" : undefined}
          className="min-h-11 rounded-md border border-zinc-300 px-3 py-2 text-base"
        />
      </label>
      <p role="status" className="sr-only">
        {announce?.message ?? ""}
      </p>
      <div aria-live="polite" className="flex flex-col gap-2">
        {q !== "" ? (
          matches.length > 0 ? (
            <ul className="flex flex-col gap-2" aria-label="Resultados">
              {matches.map((o) => (
                <li key={o.slug}>
                  <div
                    role="group"
                    aria-label={o.name}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setAdded((a) => [...a, o.slug]);
                        setAnnounce({
                          radioId: `${o.slug}-0`,
                          message: `${o.name} agregada, elegí tu nivel`,
                        });
                        setQuery("");
                      }}
                      className="min-h-11 rounded-md border border-zinc-300 px-3 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900"
                    >
                      {o.name}
                    </button>
                    <SkillInfo description={o.description} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-zinc-600">No está en la lista: agregar «{query.trim()}»</p>
              <button
                type="button"
                onClick={addCustom}
                aria-label={`Agregar ${query.trim()} como skill propia`}
                className="min-h-11 rounded-md border border-zinc-300 px-3 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900"
              >
                Agregar
              </button>
            </div>
          )
        ) : null}
        {addError ? (
          <p id="agregar-error" role="alert" className="text-sm font-medium text-red-800">
            {addError}
          </p>
        ) : null}
      </div>
      {added.map((slug) => {
        const o = options.find((x) => x.slug === slug);
        return o ? (
          <SkillRow key={slug} slug={slug} name={o.name} description={o.description} />
        ) : null;
      })}
      {livePending.map((p) => (
        <div key={p.key} className="flex flex-col gap-1">
          <input type="hidden" name={`new_name:${p.key}`} value={p.name} />
          <SkillRow
            slug={`nueva-${p.key}`}
            name={p.name}
            fieldName={`new_level:${p.key}`}
            onRemove={() => {
              setPending((list) => list.filter((x) => x.key !== p.key));
              setAnnounce({ radioId: "", message: `${p.name} quitada` });
              searchInput.current?.focus();
            }}
          />
        </div>
      ))}
    </section>
  );
}
