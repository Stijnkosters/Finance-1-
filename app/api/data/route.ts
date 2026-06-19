import { NextResponse } from "next/server";
import expensesData from "@/data/expenses.json";
import accountsData from "@/data/accounts.json";
import { readJson } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const committed = (expensesData as any).expenses || [];
  const imported = await readJson("imported-expenses.json", []);
  return NextResponse.json({
    expenses: [...committed, ...imported],
    importedCount: Array.isArray(imported) ? imported.length : 0,
    liquid: (accountsData as any).liquid || [],
    openInvoices: (accountsData as any).openInvoices || [],
  });
}
