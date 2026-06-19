// Stabiele id per uitgave, merchant-herkenning, en het toepassen van handmatige
// overrides (categorie + notitie) en geleerde regels (merchant -> categorie).

export const CATEGORIES = [
  "Software", "AI/Tools", "Marketing", "Boekhouding",
  "Bankkosten", "Team", "Verzending", "Voorraad", "Privé", "Overig",
];

export function expenseId(e: any): string {
  const base = `${e.date}|${Number(e.bedrag).toFixed(2)}|${e.methode || ""}|${(e.omschrijving || "").slice(0, 40)}`;
  let h = 0;
  for (let i = 0; i < base.length; i++) h = (h * 31 + base.charCodeAt(i)) | 0;
  return "e" + (h >>> 0).toString(36);
}

export function merchantKey(desc = ""): string {
  let s = desc.toLowerCase().split(" — ")[0];
  s = s.replace(/[^a-z\s]/g, " ");
  s = s.replace(/\b(bv|ltd|inc|gmbh|sarl|llc|com|nl|payment|betaling|ideal|sepa|incasso|via|the)\b/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s.split(" ").slice(0, 3).join(" ");
}

export function matchRule(rules: any[], desc: string): string | null {
  const k = merchantKey(desc);
  if (!k) return null;
  for (const r of rules) {
    if (r.key && (k === r.key || k.includes(r.key) || r.key.includes(k))) return r.category;
  }
  return null;
}

// Voegt id + mkey toe en past geleerde regel + handmatige override toe (override wint).
export function decorate(expenses: any[], meta: Record<string, any>, rules: any[]) {
  return expenses.map((e) => {
    const id = expenseId(e);
    const ov = meta[id] || {};
    const ruleCat = matchRule(rules, e.omschrijving || "");
    return {
      ...e,
      id,
      mkey: merchantKey(e.omschrijving || ""),
      category: ov.category || ruleCat || e.category || "Overig",
      note: ov.note || "",
      edited: !!(ov.category || ov.note),
    };
  });
}
