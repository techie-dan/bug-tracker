import type { Prisma } from "@prisma/client";

export const AREA_PARAM = "area";
export const AREA_NONE = "none";

export type ProjectAreaOption = { id: string; name: string };

/** Resolve only an area offered for the active project; stale links mean all. */
export function parseProjectAreaFilter(
  raw: string | string[] | null | undefined,
  areas: readonly ProjectAreaOption[],
): string | null {
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  if (!value) return null;
  if (value === AREA_NONE) return AREA_NONE;
  return areas.some((area) => area.id === value) ? value : null;
}

export function projectAreaFilterWhere(selected: string | null): Prisma.BugWhereInput {
  if (!selected) return {};
  return { areaId: selected === AREA_NONE ? null : selected };
}

export function projectAreaFilterLabel(
  selected: string | null,
  areas: readonly ProjectAreaOption[],
): string | null {
  if (!selected) return null;
  if (selected === AREA_NONE) return "no area";
  return areas.find((area) => area.id === selected)?.name ?? null;
}