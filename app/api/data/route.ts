import { NextResponse } from "next/server";
import expensesData from "@/data/expenses.json";
import accountsData from "@/data/accounts.json";
import { readJson } from "@/lib/store";
import { decorate, CATEGORIES } from "@/lib/meta";

export const dynamic = "force-dynamic";

export async function GET() {
  const committed = (expensesData as any).expenses || [];
  const imported = await readJson("imported-expenses.json", []);
  const meta = await readJson("expense-meta.json", {});
  const rules = await readJson("expense-rules.json", []);
  const expenses = decorate([...committed, ...imported], meta, rules).filter((e) => !e.deleted);
  return NextResponse.json({
    expenses,
    importedCount: Array.isArray(imported) ? imported.length : 0,
    rulesCount: Array.isArray(rules) ? rules.length : 0,
    categories: CATEGORIES,
    liquid: (accountsData as any).liquid || [],
    openInvoices: (accountsData as any).openInvoices || [],
  });
}
