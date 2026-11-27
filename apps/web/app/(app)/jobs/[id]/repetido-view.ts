import { repeatedForField, type OpenOfferTable } from "@job-search-os/pipeline";
import { llenarTexto, PANTALLA_TEXTOS } from "../../../../lib/textos-rediseno";
import type { RepetidoField, RepetidoTextos } from "./repetido-campo";

const T = PANTALLA_TEXTOS.repetido;

const EDITABLES: readonly RepetidoField[] = ["ingles", "anos", "pais"];

/** ¿Este dato del perfil se puede actualizar en un solo campo desde la oferta? */
export function editableField(key: string | null): RepetidoField | null {
  return (EDITABLES as readonly string[]).includes(key ?? "") ? (key as RepetidoField) : null;
}

export type RepetidoView = { field: RepetidoField; n: number; m: number; textos: RepetidoTextos };

/**
 * «Esto mismo te pasa en N de tus M ofertas» (R31-08) para un dato. Solo si se repite (N >= 2) y se
 * puede actualizar en un campo; si no, `null` y no se muestra nada. El conteo sale de las tablas de
 * requisitos de las ofertas abiertas (`repeatedForField`), nunca de un modelo.
 */
export function repetidoView(
  offers: readonly OpenOfferTable[],
  fieldKey: string | null,
): RepetidoView | null {
  const field = editableField(fieldKey);
  if (!field) return null;
  const { n, m } = repeatedForField(offers, field);
  if (n < 2) return null;
  const campo = T.campos[field];
  return {
    field,
    n,
    m,
    textos: {
      frase: llenarTexto(T.texto, { n, m }),
      boton: llenarTexto(T.boton, { campo }),
      modalTitulo: llenarTexto(T.modalTitulo, { campo }),
      modalAyuda: T.modalAyuda,
      etiqueta: T.etiquetas[field],
      guardar: T.guardar,
      guardando: T.guardando,
      cancelar: T.cancelar,
      error: T.error,
      errorValor: T.errorValor,
      inglesElegir: T.ingles.elegir,
      inglesOpciones: (["A1", "A2", "B1", "B2", "C1", "C2"] as const).map((v) => ({
        value: v,
        label: T.ingles[v],
      })),
    },
  };
}
