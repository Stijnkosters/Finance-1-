import { NextResponse } from "next/server";
import expensesData from "@/data/expenses.json";
import accountsData from "@/data/accounts.json";
import { readJson } from "@/lib/store";
import { decorate, CATEGORIES } from "@/lib/meta";

export const dynamic = "force-dynamic";

export async function GET() {
  // categorieën worden ALTIJD teruggegeven, ook als er onderweg iets misgaat
  try {
    const committed = Array.isArray((expensesData as any).expenses) ? (expensesData as any).expenses : [];
    const importedRaw = await readJson("imported-expenses.json", []);
    const imported = Array.isArray(importedRaw) ? importedRaw : [];
    const metaRaw = await readJson("expense-meta.json", {});
    const meta = metaRaw && typeof metaRaw === "object" ? metaRaw : {};
    const rulesRaw = await readJson("expense-rules.json", []);
    const rules = Array.isArray(rulesRaw) ? rulesRaw : [];

    const manualRaw = await readJson("manual-expenses.json", []);
    const manualRows = Array.isArray(manualRaw) ? manualRaw : [];

    let expenses: any[] = [];
    try {
      expenses = decorate([...committed, ...imported], meta, rules).filter((e) => !e.deleted);
    } catch {
      expenses = [];
    }

    // Handmatig ingevoerde regels (jouw sheet-manier): tellen mee als kost, maar
    // worden bewerkt via hun eigen kaart. Categorie + oordeel winnen altijd.
    const manual = manualRows.map((e: any) => ({
      ...e,
      id: e.uid,
      label: e.omschrijving || "",
      raw: e.omschrijving || "",
      note: e.note || "",
      manual: true,
      edited: true,
    }));
    expenses = [...expenses, ...manual];

    return NextResponse.json({
      expenses,
      importedCount: imported.length,
      rulesCount: rules.length,
      categories: CATEGORIES,
      liquid: (accountsData as any).liquid || [],
      openInvoices: (accountsData as any).openInvoices || [],
    });
  } catch (e: any) {
    // zelfs bij een totale fout: geef de categorieën zodat de dropdowns blijven werken
    return NextResponse.json({ expenses: [], importedCount: 0, rulesCount: 0, categories: CATEGORIES, liquid: [], openInvoices: [], error: e?.message || "data-fout" });
  }
}
