export type TriageOption = { id: string; name: string };

/**
 * Options for a triage <select> that only lists active types/categories.
 *
 * If the issue's current value has since been deactivated it is missing from
 * the active list, so the browser falls back to "No type"/"None" and saving
 * any other field clears it (#115). Keep the current value selectable,
 * labelled as inactive, so an unrelated save leaves it untouched.
 */
export function withCurrentOption(
  active: TriageOption[],
  current: (TriageOption & { isActive?: boolean }) | null | undefined,
): TriageOption[] {
  if (!current || active.some((option) => option.id === current.id)) {
    return active;
  }
  return [...active, { id: current.id, name: `${current.name} (inactive)` }];
}

export type SavedTriageValues = {
  status: string;
  severity: string;
  typeId?: string | null;
  categoryId?: string | null;
  areaId?: string | null;
  assigneeId?: string | null;
  milestoneId?: string | null;
};

/**
 * React `key` for the triage fields, built from the issue's saved values.
 *
 * The selects (and the assignee combobox) are uncontrolled, and React resets
 * a `<form action>` to the values it was mounted with after each submit. The
 * refreshed props don't update mounted fields, so they kept showing page-load
 * values and the next save sent those back, e.g. undoing a status change
 * (#261). Keying the fields on the saved values remounts them whenever the
 * server's values change, whether from this form or another control.
 */
export function triageFieldsKey(values: SavedTriageValues): string {
  return [
    values.status,
    values.severity,
    values.typeId ?? "",
    values.categoryId ?? "",
    values.areaId ?? "",
    values.assigneeId ?? "",
    values.milestoneId ?? "",
  ].join("|");
}
