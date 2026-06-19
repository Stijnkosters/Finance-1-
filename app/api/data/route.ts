import { NextResponse } from "next/server";
import expensesData from "@/data/expenses.json";
import accountsData from "@/data/accounts.json";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    expenses: (expensesData as any).expenses || [],
    liquid: (accountsData as any).liquid || [],
    openInvoices: (accountsData as any).openInvoices || [],
  });
}
