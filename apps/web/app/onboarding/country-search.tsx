"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

const MAX_SUGGESTIONS = 5;

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/**
 * Buscador de país por nombre. Escribís "cana", elegís "Canadá (CA)" con Enter o con el mouse y
 * queda como chip, con un botón para quitarlo. Manda los códigos ISO-2 como un
 * `<input type="hidden">` por país; el servidor los vuelve a validar. Con `max={1}` sirve para
 * elegir un solo país (la residencia).
 */
export function CountrySearch({
  name,
  codes,
  label = "Buscá un país por nombre o código",
  placeholder = "Canadá",
  max = 10,
  priority = [],
  invalid,
  describedBy,
  initial = [],
}: {
  /** Países ya elegidos al montar (por ejemplo, el guardado en el perfil). */
  initial?: readonly string[];
  name: string;
  /** Códigos ISO-2 asignados (la lista vive en el pipeline y la pasa el servidor). */
  codes: readonly string[];
  label?: string;
  placeholder?: string;
  /** Cuántos países se pueden elegir. */
  max?: number;
  /** Códigos que van primero entre las sugerencias (por ejemplo LATAM). */
  priority?: readonly string[];
  invalid?: boolean;
  describedBy?: string;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const refocus = useRef(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>(() => initial.slice(0, max));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [announce, setAnnounce] = useState("");

  const options = useMemo(() => {
    const names = new Intl.DisplayNames(["es"], { type: "region" });
    return codes
      .map((code) => {
        const label = names.of(code) ?? code;
        const rank = priority.indexOf(code);
        return { code, label, key: fold(`${label} ${code}`), rank: rank === -1 ? Infinity : rank };
      })
      .sort((a, b) => a.label.localeCompare(b.label, "es"));
  }, [codes, priority]);
  const labelOf = (code: string) => options.find((o) => o.code === code)?.label ?? code;

  const q = fold(query).trim();
  const suggestions = q
    ? options
        .filter((o) => !selected.includes(o.code) && o.key.includes(q))
        // Estable: los prioritarios primero, el resto sigue por nombre
        .sort((a, b) => (a.rank === b.rank ? 0 : a.rank < b.rank ? -1 : 1))
        .slice(0, MAX_SUGGESTIONS)
    : [];
  const full = selected.length >= max;
  const showList = open && !full && q !== "";
  const current = Math.min(active, Math.max(suggestions.length - 1, 0));

  // Al quitar un chip el foco vuelve al campo (esperando a que se habilite si estaba lleno)
  useEffect(() => {
    if (refocus.current) {
      refocus.current = false;
      inputRef.current?.focus();
    }
  }, [selected]);

  function add(code: string) {
    if (full || selected.includes(code)) return;
    setSelected([...selected, code]);
    setAnnounce(`${labelOf(code)} agregado.`);
    setQuery("");
    setActive(0);
    setOpen(false);
  }
  function remove(code: string) {
    refocus.current = true;
    setSelected(selected.filter((c) => c !== code));
    setAnnounce(`${labelOf(code)} quitado.`);
  }
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      // Enter nunca envía el formulario desde acá: elige la opción resaltada, si hay
      e.preventDefault();
      const pick = suggestions[current];
      if (showList && pick) add(pick.code);
    } else if (e.key === "ArrowDown" && suggestions.length) {
      e.preventDefault();
      setOpen(true);
      setActive((current + 1) % suggestions.length);
    } else if (e.key === "ArrowUp" && suggestions.length) {
      e.preventDefault();
      setOpen(true);
      setActive((current - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
    }
  }

  const found = suggestions.length;
  const spoken = showList
    ? found === 0
      ? "" // lo anuncia el aviso visible
      : `${found} ${found === 1 ? "país encontrado" : "países encontrados"}`
    : announce;

  return (
    <div className="flex flex-col gap-2 text-sm">
      {selected.map((code) => (
        <input key={code} type="hidden" name={name} value={code} />
      ))}
      {selected.length > 0 ? (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label="Países elegidos">
          {selected.map((code) => (
            <li
              key={code}
              className="flex min-h-11 items-center gap-1 rounded-md border border-zinc-300 bg-zinc-50 pl-3"
            >
              <span>
                {labelOf(code)} ({code})
              </span>
              <button
                type="button"
                onClick={() => remove(code)}
                aria-label={`Quitar ${labelOf(code)}`}
                className="min-h-11 min-w-11 rounded-md text-zinc-700 hover:text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
              >
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="relative">
        <label htmlFor={`${id}-input`} className="flex flex-col gap-1">
          {label}
          <input
            ref={inputRef}
            id={`${id}-input`}
            data-field={name}
            type="text"
            role="combobox"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={found && showList ? `${id}-opt-${current}` : undefined}
            aria-invalid={invalid ? true : undefined}
            aria-describedby={describedBy}
            autoComplete="off"
            maxLength={40}
            disabled={full}
            placeholder={full ? `Llegaste al máximo de ${max}` : placeholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              setOpen(true);
              setAnnounce("");
            }}
            onKeyDown={onKeyDown}
            onBlur={() => setOpen(false)}
            className="min-h-11 rounded-md border border-zinc-300 px-3 py-2 text-base aria-[invalid=true]:border-red-700 disabled:bg-zinc-100"
          />
        </label>
        <ul
          id={listId}
          role="listbox"
          aria-label="Países"
          hidden={!showList}
          className="absolute z-10 mt-1 max-h-60 w-full list-none overflow-auto rounded-md border border-zinc-300 bg-white p-0 shadow-sm"
        >
          {suggestions.map((o, i) => (
            <li
              key={o.code}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === current}
              // mouseDown (no click): el blur del input cerraría la lista antes del click
              onMouseDown={(e) => {
                e.preventDefault();
                add(o.code);
              }}
              className={`flex min-h-11 cursor-pointer items-center border-l-4 px-3 ${
                i === current ? "border-zinc-900 bg-zinc-200 font-medium" : "border-transparent"
              }`}
            >
              {o.label} ({o.code})
            </li>
          ))}
        </ul>
      </div>
      {/* Siempre montados: un lector de pantalla no anuncia un aviso que aparece ya armado */}
      <p role="status" className="min-h-4 text-xs text-zinc-600">
        {showList && found === 0 ? "No encontramos ese país." : ""}
      </p>
      <p className="sr-only" role="status" aria-live="polite">
        {spoken}
      </p>
      {max > 1 ? (
        <p className="text-xs text-zinc-600">
          Hasta {max} países. {selected.length}/{max} elegidos.
        </p>
      ) : null}
    </div>
  );
}
