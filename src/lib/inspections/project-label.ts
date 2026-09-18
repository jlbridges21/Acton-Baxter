/**
 * Derive project name + address from a shared expense_jobs label.
 * Labels from Master Project Log look like: "L01-26019 Liniger — 25 N Avalon Dr, Los Altos"
 * Free-text creates set the name only (address blank for manual entry).
 */

export function splitProjectLabel(label: string): { projectName: string; address: string } {
  const trimmed = label.trim();
  if (!trimmed) return { projectName: "", address: "" };
  const sep = " — ";
  const idx = trimmed.indexOf(sep);
  if (idx === -1) {
    return { projectName: trimmed, address: "" };
  }
  return {
    projectName: trimmed.slice(0, idx).trim(),
    address: trimmed.slice(idx + sep.length).trim(),
  };
}
