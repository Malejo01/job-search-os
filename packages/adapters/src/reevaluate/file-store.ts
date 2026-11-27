import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ReevalState, ReevalStore } from "./run";

/**
 * Estado de la reevaluación en un archivo JSON (R31-09). Se escribe a un temporal y se renombra, así un corte a
 * mitad de camino no deja un archivo roto. Solo ids, puntajes y versiones: nada de textos de avisos ni perfiles.
 * La carpeta por defecto (`ops/reevaluacion/`) no se versiona.
 */
export function fileReevalStore(path: string): ReevalStore {
  return {
    async load() {
      if (!existsSync(path)) return null;
      const parsed = JSON.parse(readFileSync(path, "utf8")) as ReevalState;
      if (parsed.version !== 1) throw new Error(`estado de reevaluación de otra versión (${path})`);
      return parsed;
    },
    async save(state) {
      mkdirSync(dirname(path), { recursive: true });
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
      renameSync(tmp, path);
    },
  };
}
