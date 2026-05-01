// Operator-friendly grouping of event_class entries for the picker dropdowns.
// Drives the <optgroup> separators in AnnotationForm + RandomPage so a
// reviewer can mentally jump to "Trânsito" or "Vulneráveis" instead of
// scanning all 25 labels alphabetically.
//
// Source-of-truth note: this categorization currently lives ONLY in the
// review-app frontend. If/when we want Octave's main library to know
// these groups too, promote them into octave_reference.metadata.category.
// Until then, this file is the single place to update.

import type { EventClass } from "./types";

// Operator note: "Normal" is shown FIRST so reviewers can quickly mark
// non-events without having to scroll past 25 risk classes. The risk
// categories follow in the order an operator would mentally triage them.
export const CATEGORY_ORDER = [
  "Normal",
  "Trânsito & Veículos",
  "Roubo / Furto",
  "Violência",
  "Sexual",
  "Vulneráveis",
  "Drogas",
  "Patrimônio & Ambiental",
] as const;

export type CategoryName = typeof CATEGORY_ORDER[number];

// ref_id -> category. Anything not listed falls into "(outros)" automatically.
const ID_TO_CATEGORY: Record<number, CategoryName> = {
  // Trânsito & Veículos
  48: "Trânsito & Veículos", // Cerco em motos
  51: "Trânsito & Veículos", // Roubo de veículo
  58: "Trânsito & Veículos", // Atropelamento com fuga
  59: "Trânsito & Veículos", // Acidente de trânsito sem dolo
  60: "Trânsito & Veículos", // Veículo como arma

  // Roubo / Furto
  7:  "Roubo / Furto",       // Abordagem disfarçada
  49: "Roubo / Furto",       // Roubo em via pública
  50: "Roubo / Furto",       // Furto não-confrontacional
  52: "Roubo / Furto",       // Roubo a posto/comércio

  // Violência
  53: "Violência",           // Agressão física entre desconhecidos
  54: "Violência",           // Violência doméstica em via pública
  56: "Violência",           // Exibição de arma em via pública
  57: "Violência",           // Briga em ambiente escolar

  // Sexual
  25: "Sexual",              // Coerção sexual ou íntima
  55: "Sexual",              // Importunação sexual em via pública

  // Vulneráveis (crianças, idosos, médico)
  32: "Vulneráveis",         // Tentativa de sequestro de criança
  66: "Vulneráveis",         // Criança desacompanhada em risco
  67: "Vulneráveis",         // Afogamento / colapso na água
  69: "Vulneráveis",         // Pessoa caída / colapso médico

  // Drogas
  61: "Drogas",              // Tráfico de rua
  62: "Drogas",              // Uso de drogas em via pública

  // Patrimônio & Ambiental
  63: "Patrimônio & Ambiental", // Vandalismo / dano patrimonial
  64: "Patrimônio & Ambiental", // Invasão por escalada
  65: "Patrimônio & Ambiental", // Descarte/abandono suspeito
  68: "Patrimônio & Ambiental", // Incêndio ou fumaça anormal

  // Normal scenarios — added 2026-04-30 so reviewers can mark non-events
  // explicitly instead of forcing a risk class for normal scenes.
  70: "Normal",                 // Cena vazia / sem ação aparente
  71: "Normal",                 // Tráfego normal de veículos
  72: "Normal",                 // Movimento normal de pedestres
  73: "Normal",                 // Atividade comercial / serviços normais
  74: "Normal",                 // Recreação / lazer normal
};

const FALLBACK = "(outros)" as const;
export type DisplayCategory = CategoryName | typeof FALLBACK;

/** Returns the category for a given event_class ref id, or "(outros)"
 *  if we haven't classified it yet. */
export function categoryOf(refId: number): DisplayCategory {
  return ID_TO_CATEGORY[refId] ?? FALLBACK;
}

/** Group a list of event_classes by category in `CATEGORY_ORDER`,
 *  sorting items alphabetically by short_label within each group. */
export function groupByCategory(
  classes: EventClass[]
): Array<{ category: DisplayCategory; items: EventClass[] }> {
  const buckets = new Map<DisplayCategory, EventClass[]>();
  for (const c of classes) {
    const cat = categoryOf(c.id);
    if (!buckets.has(cat)) buckets.set(cat, []);
    buckets.get(cat)!.push(c);
  }
  for (const arr of buckets.values()) {
    arr.sort((a, b) => a.short_label.localeCompare(b.short_label, "pt-BR"));
  }
  const out: Array<{ category: DisplayCategory; items: EventClass[] }> = [];
  for (const cat of CATEGORY_ORDER) {
    const items = buckets.get(cat);
    if (items && items.length) out.push({ category: cat, items });
  }
  // Trailing "(outros)" if any classes weren't categorized
  const others = buckets.get(FALLBACK);
  if (others && others.length) out.push({ category: FALLBACK, items: others });
  return out;
}
