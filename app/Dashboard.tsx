"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine, Cell,
} from "recharts";
import { TrendingUp, TrendingDown, LayoutDashboard, CalendarDays, Receipt, Wallet, RefreshCw, Upload, Trash2 } from "lucide-react";

const eur = (n: number) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(n || 0);

// Vaste terugval zodat de categorie-dropdowns nooit leeg zijn, ook als /api/data hapert.
const FALLBACK_CATEGORIES = [
  "Software", "AI/Tools", "Marketing", "Boekhouding",
  "Bankkosten", "Team", "Verzending", "Voorraad", "Leverancier betalingen", "Pandkosten", "Refund", "Transfer", "Privé", "Overig",
];
const numf = (n: number, d = 2) => new Intl.NumberFormat("nl-NL", { minimumFractionDigits: d, maximumFractionDigits: d }).format(n || 0);
const pctf = (n: number) => `${(n * 100).toFixed(1).replace(".", ",")}%`;
const ddmm = (iso: string) => { const [, m, d] = iso.split("-"); return `${d}-${m}`; };
const ddmmyyyy = (iso: string) => { const [y, m, d] = iso.split("-"); return `${d}-${m}-${y}`; };

function rangeFor(period: string) {
  const to = new Date();
  const from = new Date();
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (period === "dezemaand") {
    const y = to.getFullYear(), m = to.getMonth();
    return { from: ymd(new Date(y, m, 1)), to: ymd(new Date(y, m + 1, 0)) };
  }
  if (period === "vandaag") { /* same day */ }
  else if (period === "week") from.setDate(to.getDate() - 6);
  else if (period === "maand") from.setDate(to.getDate() - 29);
  else if (period === "kwartaal") from.setDate(to.getDate() - 89);
  return { from: ymd(from), to: ymd(to) };
}

function lastMonths(n: number) {
  const out: any[] = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    const y = d.getFullYear(), m = d.getMonth();
    const first = new Date(y, m, 1), last = new Date(y, m + 1, 0);
    out.push({
      val: `${y}-${String(m + 1).padStart(2, "0")}`,
      label: first.toLocaleDateString("nl-NL", { month: "long", year: "numeric" }),
      from: `${y}-${String(m + 1).padStart(2, "0")}-01`,
      to: last.toISOString().slice(0, 10),
    });
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}
const MONTHS = lastMonths(12);
const EXP_COLS: [string, string, boolean][] = [
  ["date", "Datum", true], ["omschrijving", "Omschrijving", true], ["category", "Categorie", true],
  ["note", "Notitie", false], ["methode", "Methode", false], ["bedrag", "Bedrag", false],
];
const LOCKED_COLS = new Set(EXP_COLS.filter(([, , lock]) => lock).map(([k]) => k));

export default function Dashboard() {
  const [tab, setTab] = useState("overzicht");
  const [period, setPeriod] = useState("dezemaand");
  const [fromInput, setFromInput] = useState("");
  const [toInput, setToInput] = useState("");
  const [monthSel, setMonthSel] = useState("");
  const [expMonth, setExpMonth] = useState("");
  const [hiddenCols, setHiddenCols] = useState<string[]>([]);
  useEffect(() => { try { const s = localStorage.getItem("dmx_hiddencols"); if (s) setHiddenCols(JSON.parse(s)); } catch {} }, []);
  const toggleCol = (k: string) => setHiddenCols((h) => {
    if (LOCKED_COLS.has(k)) return h;
    const n = h.includes(k) ? h.filter((x) => x !== k) : [...h, k];
    try { localStorage.setItem("dmx_hiddencols", JSON.stringify(n)); } catch {}
    return n;
  });
  const showCol = (k: string) => LOCKED_COLS.has(k) || !hiddenCols.includes(k);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggleSel = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const clearSel = () => setSelected(new Set());
  const deleteSelected = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    if (!confirm(`${ids.length} transactie(s) verwijderen?`)) return;
    try {
      await fetch(`/api/expense`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
      clearSel();
      await reloadData();
    } catch {}
  };
  const [pl, setPl] = useState<any>(null);
  const [data, setData] = useState<any>({ expenses: [], liquid: [], openInvoices: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const getRange = () => (fromInput && toInput ? { from: fromInput, to: toInput } : rangeFor(period));

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const { from, to } = getRange();
      const [r1, r2] = await Promise.all([
        fetch(`/api/pl?from=${from}&to=${to}`).then((r) => r.json()),
        fetch(`/api/data`).then((r) => r.json()),
      ]);
      if (!r1.ok) throw new Error(r1.error || "P&L ophalen mislukt");
      setPl(r1); setData(r2);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [period, fromInput, toInput]);

  const reloadData = async () => {
    try { const r = await fetch(`/api/data`).then((x) => x.json()); setData(r); } catch {}
  };
  const saveCat = async (e: any, category: string) => {
    setData((d: any) => ({ ...d, expenses: (d.expenses || []).map((x: any) => (x.id === e.id ? { ...x, category } : x)) }));
    try {
      await fetch(`/api/expense`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: e.id, mkey: e.mkey, category, remember: true }) });
      await reloadData();
    } catch {}
  };
  const saveNote = async (e: any, note: string) => {
    setData((d: any) => ({ ...d, expenses: (d.expenses || []).map((x: any) => (x.id === e.id ? { ...x, note } : x)) }));
    try {
      await fetch(`/api/expense`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: e.id, note, remember: false }) });
    } catch {}
  };
  const saveLabel = async (e: any, label: string) => {
    setData((d: any) => ({ ...d, expenses: (d.expenses || []).map((x: any) => (x.id === e.id ? { ...x, label } : x)) }));
    try {
      await fetch(`/api/expense`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: e.id, mkey: e.mkey, label, remember: true }) });
      await reloadData();
    } catch {}
  };

  const pickQuick = (v: string) => { setFromInput(""); setToInput(""); setMonthSel(""); setPeriod(v); };
  const pickMonth = (val: string) => {
    setMonthSel(val);
    const m = MONTHS.find((x) => x.val === val);
    if (m) { setFromInput(m.from); setToInput(m.to); }
  };
  const custom = !!(fromInput && toInput);

  const days = pl?.days || [];
  const totals = pl?.totals || {};

  const NON_COST = ["Transfer", "Privé", "Refund"];
  const expensesInRange = useMemo(() => {
    if (!pl) return [];
    const { from, to } = pl.range;
    return (data.expenses || []).filter((e: any) => e.date >= from && e.date <= to && !NON_COST.includes(e.category));
  }, [data, pl]);
  const overhead = expensesInRange.reduce((a: number, e: any) => a + (e.bedrag || 0), 0);

  const timeline = useMemo(() => {
    let cum = 0;
    const exByDay: Record<string, number> = {};
    expensesInRange.forEach((e: any) => { exByDay[e.date] = (exByDay[e.date] || 0) + (e.bedrag || 0); });
    return days.map((d: any) => {
      const net = d.totalProfit - (exByDay[d.date] || 0);
      cum += net;
      return { date: d.date, label: ddmm(d.date), dag: Math.round(net), cumulatief: Math.round(cum) };
    });
  }, [days, expensesInRange]);

  const netTotal = (totals.totalProfit || 0) - overhead;
  const allTimeNet = timeline.length ? timeline[timeline.length - 1].cumulatief : 0;
  const up = allTimeNet >= 0;

  const liquid = (data.liquid || []).reduce((a: number, r: any) => a + (r.amount || 0), 0);
  const due = (data.openInvoices || []).reduce((a: number, r: any) => a + (r.amount || 0), 0);

  const costBreakdown = useMemo(() => {
    const items = [
      { key: "Productkosten (COGS)", val: totals.cogs || 0 },
      { key: "Advertentiekosten", val: totals.adspend || 0 },
      { key: "Overhead", val: overhead },
      { key: "Refunds", val: totals.refunds || 0 },
      { key: "Shopify fees (schatting)", val: totals.fees || 0 },
    ].filter((i) => i.val > 0).sort((a, b) => b.val - a.val);
    const sum = items.reduce((a, i) => a + i.val, 0) || 1;
    return items.map((i) => ({ ...i, share: i.val / sum }));
  }, [totals, overhead]);

  const byCategory = useMemo(() => {
    const m: Record<string, number> = {};
    expensesInRange.forEach((e: any) => { m[e.category || "Overig"] = (m[e.category || "Overig"] || 0) + (e.bedrag || 0); });
    const items = Object.entries(m).map(([key, val]) => ({ key, val: val as number })).sort((a, b) => b.val - a.val);
    const sum = items.reduce((a, i) => a + i.val, 0) || 1;
    return { items: items.map((i) => ({ ...i, share: i.val / sum })), total: items.reduce((a, i) => a + i.val, 0) };
  }, [expensesInRange]);

  return (
    <div>
      <header className="top">
        <div className="brand">
          <div className="logo">P&amp;L</div>
          <div>
            <div className="title">Drivemax Profit Cockpit</div>
            <div className="sub">Auto-COGS uit Shopify-orders</div>
          </div>
        </div>
        <button className="seg" onClick={load} title="Verversen" style={{ cursor: "pointer" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 13px" }}>
            <RefreshCw size={14} /> Verversen
          </span>
        </button>
      </header>

      <nav className="nav">
        {[
          ["overzicht", "Overzicht", LayoutDashboard],
          ["pl", "Dagelijkse P&L", CalendarDays],
          ["uitgaves", "Uitgaves", Receipt],
          ["balans", "Vermogen", Wallet],
          ["import", "Importeren", Upload],
        ].map(([k, label, Icon]: any) => (
          <button key={k} className={`tab ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>
            <Icon size={16} /> {label}
          </button>
        ))}
      </nav>

      <main className="main">
        <div className="row-between">
          <h2 className="h2">{tab === "overzicht" ? "Overzicht" : tab === "pl" ? "Dagelijkse P&L" : tab === "uitgaves" ? "Uitgaves" : tab === "balans" ? "Vermogen" : "Importeren"}</h2>
          {tab !== "import" && tab !== "uitgaves" && (
            <div className="ctrls">
              <div className="seg">
                {[["dezemaand", "Deze maand"], ["vandaag", "Vandaag"], ["week", "Week"], ["maand", "30d"], ["kwartaal", "90d"]].map(([v, l]) => (
                  <button key={v} className={!custom && period === v ? "on" : ""} onClick={() => pickQuick(v)}>{l}</button>
                ))}
              </div>
              <select className="msel" value={monthSel} onChange={(e) => pickMonth(e.target.value)}>
                <option value="">Maand…</option>
                {MONTHS.map((m) => <option key={m.val} value={m.val}>{m.label}</option>)}
              </select>
              <input className="dinp" type="date" value={fromInput} onChange={(e) => { setMonthSel(""); setFromInput(e.target.value); }} />
              <span className="dim">→</span>
              <input className="dinp" type="date" value={toInput} onChange={(e) => { setMonthSel(""); setToInput(e.target.value); }} />
            </div>
          )}
          {tab === "uitgaves" && (
            <div className="ctrls">
              <select className="msel" value={expMonth} onChange={(e) => setExpMonth(e.target.value)}>
                <option value="">Alle maanden</option>
                {MONTHS.map((m) => <option key={m.val} value={m.val}>{m.label}</option>)}
              </select>
            </div>
          )}
        </div>
        {pl && (tab === "overzicht" || tab === "pl") && (
          <div className="rangelbl dim">Periode: {ddmmyyyy(pl.range.from)} – {ddmmyyyy(pl.range.to)}</div>
        )}

        {error && tab !== "import" && <div className="banner err">Fout: {error}. Check je env vars in Railway.</div>}
        {loading && tab !== "import" && <div className="loading">Data ophalen…</div>}

        {!loading && !error && pl && (
          <>
            {pl.cogsWarning && tab === "overzicht" && (
              <div className="banner warn">{pl.cogsWarning}</div>
            )}
            {pl.cogsSource === "nichebay" && tab === "overzicht" && (
              <div className="banner info">
                COGS automatisch uit NicheBay · {pl.nbMatched}/{pl.orderCount} orders gematcht op ordernummer.
                {pl.nbMatched === 0 && " Geen matches — open /api/nichebay om de veldnamen te checken."}
              </div>
            )}
            {pl.adWarning && tab === "overzicht" && (
              <div className="banner warn">{pl.adWarning}</div>
            )}
            {pl.cogsSource !== "nichebay" && pl.missingCosts?.length > 0 && tab === "overzicht" && (
              <div className="banner warn">
                {pl.missingCosts.length} producten hebben nog geen inkoopprijs in <b>costs.json</b> → hun COGS telt als €0. Vul ze in voor een kloppende winst.
              </div>
            )}
            {pl.unmatched?.length > 0 && tab === "overzicht" && (
              <div className="banner info">
                {pl.unmatched.length} verkochte variant(en) staan niet in costs.json (bijv. nieuwe producten). Voeg hun variant-GID toe.
              </div>
            )}

            {tab === "overzicht" && (
              <>
                <section className={`hero ${up ? "up" : "down"}`}>
                  <div>
                    <div className="hero-label">Netto resultaat · {pl.range.from} t/m {pl.range.to}</div>
                    <div className="hero-value">
                      {up ? <TrendingUp size={28} /> : <TrendingDown size={28} />}
                      <span>{eur(netTotal)}</span>
                    </div>
                    <div className="hero-note">{up ? "In de plus." : "In de min — kosten drukken."} P&L-winst {eur(totals.totalProfit || 0)} − overhead {eur(overhead)}.</div>
                  </div>
                  <div>
                    <ResponsiveContainer width="100%" height={120}>
                      <AreaChart data={timeline} margin={{ top: 6, right: 4, left: 4, bottom: 0 }}>
                        <defs>
                          <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={up ? "#0E8A52" : "#CE2C2C"} stopOpacity={0.35} />
                            <stop offset="100%" stopColor={up ? "#0E8A52" : "#CE2C2C"} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <ReferenceLine y={0} stroke="rgba(255,255,255,.4)" strokeDasharray="3 3" />
                        <Tooltip content={<TipCum />} />
                        <Area type="monotone" dataKey="cumulatief" stroke={up ? "#0E8A52" : "#CE2C2C"} strokeWidth={2.5} fill="url(#g)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </section>

                <div className="kpis">
                  <Kpi label="Omzet" value={eur(totals.revenue || 0)} />
                  <Kpi label={`COGS${pl.cogsSource === "nichebay" ? " · NicheBay" : " · handmatig"}`} value={eur(totals.cogs || 0)} tone="down" />
                  <Kpi label={`Ad spend${pl.adSource === "google_ads" ? " · Google Ads" : pl.adSource === "sheet" ? " · Sheet" : ""}`} value={eur(totals.adspend || 0)} />
                  <Kpi label="P&L winst" value={eur(totals.totalProfit || 0)} tone={(totals.totalProfit || 0) >= 0 ? "up" : "down"} />
                  <Kpi label="Netto na overhead" value={eur(netTotal)} tone={netTotal >= 0 ? "up" : "down"} />
                  <Kpi label="Orders / units" value={`${totals.orders || 0} / ${totals.units || 0}`} />
                </div>

                <div className="grid2">
                  <Card title="Waar gaat je geld heen">
                    <div className="breakdown">
                      {costBreakdown.length === 0 && <div className="muted">Nog geen kosten.</div>}
                      {costBreakdown.map((c) => (
                        <div key={c.key}>
                          <div className="bd-head"><span>{c.key}</span><span className="mono">{eur(c.val)} · {pctf(c.share)}</span></div>
                          <div className="bar"><div className="bar-fill" style={{ width: `${c.share * 100}%` }} /></div>
                        </div>
                      ))}
                    </div>
                  </Card>
                  <Card title="Cashpositie" subtitle="uit accounts.json">
                    <div className="cash">
                      <div className="cash-row"><span>Liquide middelen</span><b className="mono">{eur(liquid)}</b></div>
                      <div className="cash-row"><span>Openstaand</span><b className="mono amber">{eur(due)}</b></div>
                      <div className="cash-div" />
                      <div className="cash-row big"><span>Netto positie</span><b className={`mono ${liquid - due >= 0 ? "green" : "red"}`}>{eur(liquid - due)}</b></div>
                    </div>
                  </Card>
                </div>

                <Card title="Uitgaven per categorie" subtitle={`overhead · transfers niet meegeteld · totaal ${eur(byCategory.total)}`}>
                  <div className="breakdown">
                    {byCategory.items.length === 0 && <div className="muted">Geen overhead in deze periode. Kies een maand of importeer je bankafschrift.</div>}
                    {byCategory.items.map((c) => (
                      <div key={c.key}>
                        <div className="bd-head"><span>{c.key}</span><span className="mono">{eur(c.val)} · {pctf(c.share)}</span></div>
                        <div className="bar"><div className="bar-fill alt" style={{ width: `${c.share * 100}%` }} /></div>
                      </div>
                    ))}
                  </div>
                </Card>

                <Card title="Resultaat per dag" subtitle="netto (P&L − overhead)">
                  {timeline.length === 0 ? <div className="muted">Geen orders in deze periode.</div> : (
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={timeline}>
                        <CartesianGrid vertical={false} stroke="#EEF0F4" />
                        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#8A909C" }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fontSize: 11, fill: "#8A909C" }} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => (v / 1000).toFixed(0) + "k"} />
                        <ReferenceLine y={0} stroke="#C9CDD6" />
                        <Tooltip content={<TipDag />} cursor={{ fill: "rgba(58,63,214,.05)" }} />
                        <Bar dataKey="dag" radius={[3, 3, 0, 0]}>
                          {timeline.map((d, i) => <Cell key={i} fill={d.dag >= 0 ? "#0E8A52" : "#CE2C2C"} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </Card>
              </>
            )}

            {tab === "pl" && (
              <Card title="Dagelijkse P&L" subtitle={`${days.length} dagen · COGS automatisch gematcht`}>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Datum</th><th className="r">Orders</th><th className="r">Omzet</th><th className="r">Refunds</th>
                        <th className="r">COGS</th><th className="r">Fees</th><th className="r">Ad</th>
                        <th className="r">Gross</th><th className="r">Winst</th><th className="r">ROAS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {days.length === 0 && <tr><td colSpan={10} className="dim center">Geen orders.</td></tr>}
                      {days.map((d: any) => (
                        <tr key={d.date}>
                          <td className="nowrap">{ddmmyyyy(d.date)}</td>
                          <td className="r mono">{d.orders}</td>
                          <td className="r mono">{eur(d.revenue)}</td>
                          <td className="r mono dim">{d.refunds ? eur(d.refunds) : "—"}</td>
                          <td className="r mono">{eur(d.cogs)}</td>
                          <td className="r mono dim">{eur(d.fees)}</td>
                          <td className="r mono">{d.adspend ? eur(d.adspend) : "—"}</td>
                          <td className="r mono">{eur(d.grossProfit)}</td>
                          <td className={`r mono strong ${d.totalProfit >= 0 ? "green" : "red"}`}>{eur(d.totalProfit)}</td>
                          <td className="r mono">{d.roas ? numf(d.roas) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                    {days.length > 0 && (
                      <tfoot>
                        <tr>
                          <td>TOTAAL</td>
                          <td className="r mono">{totals.orders}</td>
                          <td className="r mono">{eur(totals.revenue)}</td>
                          <td className="r mono">{eur(totals.refunds)}</td>
                          <td className="r mono">{eur(totals.cogs)}</td>
                          <td className="r mono">{eur(totals.fees)}</td>
                          <td className="r mono">{eur(totals.adspend)}</td>
                          <td className="r mono">{eur((totals.revenue || 0) - (totals.cogs || 0))}</td>
                          <td className={`r mono strong ${totals.totalProfit >= 0 ? "green" : "red"}`}>{eur(totals.totalProfit)}</td>
                          <td></td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </Card>
            )}

            {tab === "uitgaves" && (() => {
              const rows = [...(data.expenses || [])]
                .filter((e: any) => !expMonth || (e.date || "").startsWith(expMonth))
                .sort((a: any, b: any) => (b.date || "").localeCompare(a.date || ""));
              const visCount = EXP_COLS.filter(([k]) => showCol(k)).length;
              const allSel = rows.length > 0 && rows.every((e: any) => selected.has(e.id));
              const toggleAll = () => { const n = new Set(selected); allSel ? rows.forEach((e: any) => n.delete(e.id)) : rows.forEach((e: any) => n.add(e.id)); setSelected(n); };
              return (
                <Card title="Uitgaves" subtitle={`${rows.length} regels${data.importedCount ? ` · ${data.importedCount} geïmporteerd` : ""} · categorie wijzigen = onthouden`}>
                  <div className="colbar">
                    <span className="dim">Kolommen:</span>
                    {EXP_COLS.filter(([k]) => !LOCKED_COLS.has(k)).map(([k, l]) => (
                      <button key={k} className={`colchip ${showCol(k) ? "on" : ""}`} onClick={() => toggleCol(k)}>{l}</button>
                    ))}
                  </div>
                  {selected.size > 0 && (
                    <div className="bulkbar">
                      <span>{selected.size} geselecteerd</span>
                      <button className="bulkdel" onClick={deleteSelected}><Trash2 size={14} /> Verwijderen</button>
                      <button className="bulkclear" onClick={clearSel}>Deselecteren</button>
                    </div>
                  )}
                  <div className="table-wrap">
                    <table className="table">
                      <thead><tr>
                        <th className="selcol"><input type="checkbox" checked={allSel} onChange={toggleAll} /></th>
                        {EXP_COLS.map(([k, l]) => showCol(k) ? <th key={k} className={k === "bedrag" ? "r" : ""}>{l}</th> : null)}
                      </tr></thead>
                      <tbody>
                        {rows.length === 0 && <tr><td colSpan={visCount + 1} className="dim center">Geen uitgaves in deze periode.</td></tr>}
                        {rows.map((e: any, i: number) => (
                          <ExpenseRow key={e.id || i} e={e} cats={(data.categories && data.categories.length) ? data.categories : FALLBACK_CATEGORIES} show={showCol}
                            sel={selected.has(e.id)} onSel={() => toggleSel(e.id)} onCat={saveCat} onNote={saveNote} onLabel={saveLabel} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              );
            })()}

          </>
        )}

        {tab === "balans" && <VermogenPanel onMonth={(m: string) => { setExpMonth(m); setTab("uitgaves"); }} />}

        {tab === "import" && <ImportPanel onDone={load} onReload={reloadData} cats={(data.categories && data.categories.length) ? data.categories : FALLBACK_CATEGORIES} />}
      </main>
    </div>
  );
}

function VermogenPanel({ onMonth }: any) {
  const [assets, setAssets] = useState<any[]>([]);
  const [liab, setLiab] = useState<any[]>([]);
  const [snaps, setSnaps] = useState<any[]>([]);
  const [captured, setCaptured] = useState<any>({});
  const [curve, setCurve] = useState<any[]>([]);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [asof, setAsof] = useState<string>("");
  const [asofMonths, setAsofMonths] = useState<any[]>([]);
  const [asofView, setAsofView] = useState<any>(null);
  const [editMode, setEditMode] = useState(false);
  const [openings, setOpenings] = useState<Record<string, any>>({});
  const [openDate, setOpenDate] = useState("2026-01-01");
  const [openSaved, setOpenSaved] = useState(false);
  const [persisted, setPersisted] = useState(true);
  const [saved, setSaved] = useState(false);
  const [nbMsg, setNbMsg] = useState<string | null>(null);
  const [nbBusy, setNbBusy] = useState(false);

  const pullNicheBay = async () => {
    setNbBusy(true); setNbMsg(null);
    try {
      const r = await fetch("/api/nichebay-finance").then((x) => x.json());
      if (r.ok && r.captured) { setNbMsg(`NicheBay saldo opgehaald: ${eur(r.captured.amount)} (via ${r.captured.via}).`); await load(); }
      else if (r.ok) setNbMsg("Geen saldo-veld gevonden in de NicheBay-respons. Stuur Stijn de output van /api/nichebay-finance.");
      else setNbMsg(r.error || "Ophalen mislukt.");
    } catch (e: any) { setNbMsg(e.message); }
    finally { setNbBusy(false); }
  };

  const [wiseMsg, setWiseMsg] = useState<string | null>(null);
  const [wiseBusy, setWiseBusy] = useState(false);
  const pullWise = async () => {
    setWiseBusy(true); setWiseMsg(null);
    try {
      const r = await fetch("/api/wise-balance").then((x) => x.json());
      if (r.ok && r.captured) {
        const others = (r.currencies || []).filter((c: any) => c.currency !== "EUR" && c.value);
        const extra = others.length ? ` (andere valuta: ${others.map((c: any) => `${c.value} ${c.currency}`).join(", ")} — voeg die los toe)` : "";
        setWiseMsg(`Wise EUR-saldo opgehaald: ${eur(r.captured.amount)}.${extra}`);
        await load();
      } else setWiseMsg(r.error || "Ophalen mislukt.");
    } catch (e: any) { setWiseMsg(e.message); }
    finally { setWiseBusy(false); }
  };

  const load = async (asOf?: string) => {
    try {
      const q = asOf ? `?asof=${asOf}` : "";
      const r = await fetch(`/api/vermogen${q}`).then((x) => x.json());
      if (r.ok) {
        setAssets(r.assets || []); setLiab(r.liabilities || []); setSnaps(r.snapshots || []); setCaptured(r.captured || {});
        setCurve(r.monthlyNetWorth || []); setPersisted(r.persisted !== false);
        setAsof(r.asof || ""); setAsofMonths(r.asofMonths || []);
        setOpenings((r.openings && r.openings.balances) || {}); setOpenDate((r.openings && r.openings.date) || "2026-01-01");
        setAsofView({ assets: r.assetsAsof || [], liab: r.liabAsof || [], net: r.netAsof || 0, aTot: r.assetsTotalAsof || 0, lTot: r.liabTotalAsof || 0, date: r.asofDate || "" });
      }
    } catch {}
  };
  useEffect(() => { load(); }, []);
  const pickAsof = (m: string) => { setAsof(m); load(m); };

  const saveOpenings = async (next = openings, date = openDate) => {
    try {
      await fetch("/api/vermogen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "openings", date, balances: next }) });
      setOpenSaved(true); setTimeout(() => setOpenSaved(false), 1400);
      await load(asof || undefined);
    } catch {}
  };
  const setOpening = (name: string, v: string) => setOpenings((o) => ({ ...o, [name]: v }));

  const save = async (a = assets, l = liab) => {
    try {
      await fetch("/api/vermogen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assets: a, liabilities: l }) });
      setSaved(true); setTimeout(() => setSaved(false), 1200);
    } catch {}
  };

  const today = () => new Date().toISOString().slice(0, 10);
  const edit = (which: "a" | "l", i: number, field: string, value: any) => {
    const apply = (r: any, idx: number) => {
      if (idx !== i) return r;
      const nr = { ...r, [field]: value };
      // bij handmatig invullen van een bedrag: zet datum op vandaag als die nog leeg is
      if (field === "amount" && !r.date) nr.date = today();
      return nr;
    };
    if (which === "a") setAssets((rows) => rows.map(apply));
    else setLiab((rows) => rows.map(apply));
  };
  const addRow = (which: "a" | "l") => {
    if (which === "a") { const n = [...assets, { name: "", amount: 0 }]; setAssets(n); save(n, liab); }
    else { const n = [...liab, { name: "", amount: 0 }]; setLiab(n); save(assets, n); }
  };
  const removeRow = (which: "a" | "l", i: number) => {
    if (which === "a") { const n = assets.filter((_, idx) => idx !== i); setAssets(n); save(n, liab); }
    else { const n = liab.filter((_, idx) => idx !== i); setLiab(n); save(assets, n); }
  };

  const sum = (rows: any[]) => rows.reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const aTot = sum(assets), lTot = sum(liab), net = aTot - lTot;

  const snapshot = async () => {
    await save();
    try {
      const r = await fetch("/api/vermogen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "snapshot", month }) }).then((x) => x.json());
      if (r.ok) setSnaps(r.snapshots || []);
    } catch {}
  };

  const monthLabel = (m: string) => { const [y, mm] = m.split("-"); return new Date(+y, +mm - 1, 1).toLocaleDateString("nl-NL", { month: "long", year: "numeric" }); };

  const capturedFor = (name: string) => {
    const key = Object.keys(captured).find((k) => name && name.toLowerCase().includes(k.toLowerCase()));
    if (!key) return null;
    const c = captured[key];
    const amount = c && c.type === "creditcard" ? Math.abs(Number(c.amount) || 0) : c.amount;
    return { key, ...c, amount };
  };

  const rows = (which: "a" | "l", list: any[]) => (
    <div className="cash">
      {list.map((r, i) => {
        const cap = capturedFor(r.name);
        return (
          <div className="vrow" key={i}>
            <input className="vname" value={r.name} placeholder="naam" onChange={(e) => edit(which, i, "name", e.target.value)} onBlur={() => save()} />
            <input className="vamt mono" type="number" value={r.amount} onChange={(e) => edit(which, i, "amount", e.target.value)} onBlur={() => save()} />
            {!cap && (
              <input className="vdate" type="date" value={r.date || ""} title="Saldo per deze datum"
                onChange={(e) => edit(which, i, "date", e.target.value)} onBlur={() => save()} />
            )}
            <button className="vdel" onClick={() => removeRow(which, i)} title="Verwijderen">×</button>
            {cap && Math.abs((cap.amount || 0) - (Number(r.amount) || 0)) > 0.005 && (
              <button className="vcap" title={`Saldo uit import (${ddmmyyyy(cap.date)})`}
                onClick={() => { edit(which, i, "amount", cap.amount); setTimeout(() => save(), 0); }}>
                uit import: {eur(cap.amount)} ↺
              </button>
            )}
            {cap && Math.abs((cap.amount || 0) - (Number(r.amount) || 0)) <= 0.005 && (
              <span className="vcapok" title={`Automatisch uit import (${ddmmyyyy(cap.date)})`}>auto · {ddmmyyyy(cap.date)}</span>
            )}
          </div>
        );
      })}
      <button className="vadd" onClick={() => addRow(which)}>+ regel</button>
    </div>
  );

  const view = asofView || { assets: [], liab: [], net: 0, aTot: 0, lTot: 0, date: "" };
  const showNet = editMode ? net : view.net;
  const showA = editMode ? aTot : view.aTot;
  const showL = editMode ? lTot : view.lTot;

  return (
    <>
      {!persisted && <div className="banner warn">Geen opslag actief — zet DATA_DIR + Railway Volume, anders wordt je vermogen niet bewaard.</div>}

      <div className="ctrls" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        <span className="dim" style={{ fontSize: 13 }}>Peildatum:</span>
        <select className="msel" value={asof} onChange={(e) => pickAsof(e.target.value)} disabled={editMode}>
          {asofMonths.map((m: any) => <option key={m.val} value={m.val}>einde {m.label}</option>)}
        </select>
        <button className={`colchip ${!editMode ? "on" : ""}`} onClick={() => { setEditMode(false); load(asof || undefined); }}>Snapshot (alles gelijk)</button>
        <button className={`colchip ${editMode ? "on" : ""}`} onClick={() => setEditMode(true)}>Balansen bewerken</button>
      </div>

      <div className={`hero ${showNet >= 0 ? "up" : "down"}`} style={{ marginBottom: 18, gridTemplateColumns: "1fr" }}>
        <div>
          <div className="hero-label">NETTO VERMOGEN{!editMode && view.date ? ` · STAND PER ${ddmmyyyy(view.date)}` : ""}</div>
          <div className="hero-value">{showNet >= 0 ? <TrendingUp size={30} /> : <TrendingDown size={30} />} {eur(showNet)}</div>
          <div className="hero-note">Bezittingen {eur(showA)} − schulden {eur(showL)}.{editMode && saved ? " ✓ opgeslagen" : ""}{!editMode ? " Alle rekeningen op dezelfde datum." : ""}</div>
        </div>
      </div>

      {editMode ? (
        <>
          <Card title={`Beginsaldo per ${ddmmyyyy(openDate)}`} subtitle={openSaved ? "✓ opgeslagen" : "vul één keer in"}>
            <div className="vcap" style={{ marginBottom: 6 }}>
              Vul per rekening je saldo op {ddmmyyyy(openDate)} in. De app rekent vanaf daar met je CSV-transacties élk maand-einde uit (beginsaldo + erin − eruit). Rekeningen waarvan je CSV-bestand zelf een saldo-kolom heeft (bijv. Rabo/Revolut) gebruiken dat exacte saldo.
            </div>
            <table className="table"><tbody>
              {assets.map((a: any, i: number) => (
                <tr key={i}>
                  <td>{a.name}</td>
                  <td className="r" style={{ width: 160 }}>
                    <input className="dinp" type="number" step="0.01" placeholder="0,00" style={{ width: 130, textAlign: "right" }}
                      value={openings[a.name] ?? ""} onChange={(e) => setOpening(a.name, e.target.value)} onBlur={() => saveOpenings()} />
                  </td>
                </tr>
              ))}
            </tbody></table>
            <div className="vcap" style={{ marginTop: 8 }}>Opslaan gebeurt automatisch zodra je een veld verlaat.{openSaved ? " ✓ opgeslagen" : ""}</div>
          </Card>
          <div className="grid2" style={{ marginTop: 14 }}>
            <Card title="Bezittingen (huidige stand)" subtitle={eur(aTot)}>{rows("a", assets)}</Card>
            <Card title="Schulden (huidige stand)" subtitle={eur(lTot)}>{rows("l", liab)}</Card>
          </div>
        </>
      ) : (
        <div className="grid2">
          <Card title={`Bezittingen · per ${view.date ? ddmmyyyy(view.date) : "—"}`} subtitle={eur(view.aTot)}>
            <table className="table"><tbody>
              {view.assets.map((r: any, i: number) => (
                <tr key={i}><td>{r.name}</td><td className="r mono strong">{eur(r.amount)}</td><td className="r">{r.auto ? <span className="vcapok">auto</span> : <span className="dim" style={{ fontSize: 11 }}>handmatig</span>}</td></tr>
              ))}
            </tbody></table>
          </Card>
          <Card title={`Schulden · per ${view.date ? ddmmyyyy(view.date) : "—"}`} subtitle={eur(view.lTot)}>
            <table className="table"><tbody>
              {view.liab.map((r: any, i: number) => (
                <tr key={i}><td>{r.name}</td><td className="r mono strong">{eur(r.amount)}</td></tr>
              ))}
            </tbody></table>
          </Card>
        </div>
      )}

      <div className="ctrls" style={{ marginTop: 10 }}>
        <button className="vadd" onClick={pullNicheBay} disabled={nbBusy}>{nbBusy ? "Bezig…" : "↻ NicheBay saldo ophalen"}</button>
        {nbMsg && <span className="dim" style={{ fontSize: 13 }}>{nbMsg}</span>}
      </div>
      <div className="ctrls" style={{ marginTop: 6 }}>
        <button className="vadd" onClick={pullWise} disabled={wiseBusy}>{wiseBusy ? "Bezig…" : "↻ Wise saldo ophalen"}</button>
        {wiseMsg && <span className="dim" style={{ fontSize: 13 }}>{wiseMsg}</span>}
      </div>

      {curve.length > 0 && (
        <Card title="Vermogen per maand" subtitle="klik een maand voor de transacties">
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={curve.map((c) => ({ ...c, label: monthLabel(c.month) }))}>
              <defs><linearGradient id="vg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0E8A52" stopOpacity={0.25} /><stop offset="100%" stopColor="#0E8A52" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid vertical={false} stroke="#EEF0F4" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#8A909C" }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#8A909C" }} tickLine={false} axisLine={false} width={52} tickFormatter={(v) => (v / 1000).toFixed(0) + "k"} />
              <Tooltip formatter={(v: any) => eur(v)} labelStyle={{ color: "#1A1D24" }} />
              <Area type="monotone" dataKey="net" stroke="#0E8A52" strokeWidth={2} fill="url(#vg)" />
            </AreaChart>
          </ResponsiveContainer>
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table className="table">
              <thead><tr><th>Maand</th><th className="r">Erin</th><th className="r">Eruit</th><th className="r">Netto vermogen</th><th className="r">Verschil</th><th></th></tr></thead>
              <tbody>
                {[...curve].reverse().map((s, i, arr) => {
                  const prev = arr[i + 1];
                  const delta = prev ? s.net - prev.net : null;
                  return (
                    <tr key={s.month} className="clickrow" onClick={() => onMonth && onMonth(s.month)}>
                      <td className="nowrap">{monthLabel(s.month)}</td>
                      <td className="r mono green">{s.in ? eur(s.in) : "—"}</td>
                      <td className="r mono red">{s.out ? eur(s.out) : "—"}</td>
                      <td className="r mono strong">{eur(s.net)}</td>
                      <td className={`r mono ${delta == null ? "dim" : delta >= 0 ? "green" : "red"}`}>{delta == null ? "—" : `${delta >= 0 ? "▲" : "▼"} ${eur(Math.abs(delta))}`}</td>
                      <td className="r dim" style={{ fontSize: 12 }}>transacties →</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            Gebaseerd op rekeningen met saldo in de CSV (Rabobank, Revolut, Wise-statement). Rekeningen zonder saldo-historie staan vlak op hun huidige waarde. Upload je CSV's vanaf januari om de hele curve te vullen.
          </p>
        </Card>
      )}

      <Card title="Maand vastleggen" subtitle="bewaar je vermogen aan het eind van de maand">
        <div className="ctrls" style={{ marginBottom: 14 }}>
          <select className="msel" value={month} onChange={(e) => setMonth(e.target.value)}>
            {MONTHS.map((m) => <option key={m.val} value={m.val}>{m.label}</option>)}
          </select>
          <button className="bulkdel" style={{ background: "var(--accent)" }} onClick={snapshot}>Snapshot opslaan</button>
        </div>
        {snaps.length === 0 ? <div className="muted">Nog geen snapshots. Vul je saldo's in en sla de maand op.</div> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Maand</th><th className="r">Bezittingen</th><th className="r">Schulden</th><th className="r">Netto vermogen</th><th className="r">Verschil</th></tr></thead>
              <tbody>
                {[...snaps].reverse().map((s, i, arr) => {
                  const prev = arr[i + 1];
                  const delta = prev ? s.net - prev.net : null;
                  return (
                    <tr key={s.month}>
                      <td className="nowrap">{monthLabel(s.month)}</td>
                      <td className="r mono">{eur(s.assetsTotal)}</td>
                      <td className="r mono">{eur(s.liabTotal)}</td>
                      <td className="r mono strong">{eur(s.net)}</td>
                      <td className={`r mono ${delta == null ? "dim" : delta >= 0 ? "green" : "red"}`}>{delta == null ? "—" : `${delta >= 0 ? "▲" : "▼"} ${eur(Math.abs(delta))}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function ImportPanel({ onDone, onReload, cats }: any) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any>(null);
  const [pending, setPending] = useState<any[]>([]);
  const [income, setIncome] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // Automatische koppelingen
  const [ppBusy, setPpBusy] = useState(false);
  const [ppMsg, setPpMsg] = useState<string | null>(null);
  const [bankBusy, setBankBusy] = useState(false);
  const [bankMsg, setBankMsg] = useState<string | null>(null);
  const [institutions, setInstitutions] = useState<any[]>([]);
  const [connected, setConnected] = useState<any[]>([]);
  const [chosenInst, setChosenInst] = useState("");

  const editIncome = async (e: any, category: string) => {
    setIncome((rows) => rows.map((x) => (x.id === e.id ? { ...x, category } : x)));
    try { await fetch("/api/income", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: e.id, category }) }); } catch {}
  };

  const syncPaypal = async () => {
    setPpBusy(true); setPpMsg(null);
    try {
      const r = await fetch("/api/paypal/sync").then((x) => x.json());
      if (r.ok) {
        const bd = (r.balanceBreakdown || []).filter((b: any) => b.currency !== "EUR");
        const bdTxt = bd.length ? ` (incl. ${bd.map((b: any) => `${b.currency} ${b.value}${b.eur != null ? `→${eur(b.eur)}` : " (koers ?)"}`).join(", ")})` : "";
        const fxTxt = r.fx && r.fx.converted ? ` · ${r.fx.converted} vreemde valuta omgerekend` : "";
        const fxFail = r.fx && r.fx.failed ? ` · ${r.fx.failed} koers niet gevonden` : "";
        setPpMsg(`PayPal: saldo ${r.balance ? eur(r.balance) : "?"}${bdTxt} · ${r.staged} nieuw in wachtrij · ${r.income} inkomend · ${r.duplicates} dubbel${fxTxt}${fxFail}.`);
        await refreshPending(); onReload && onReload();
      }
      else setPpMsg(r.error || "Mislukt.");
    } catch (e: any) { setPpMsg(e.message); } finally { setPpBusy(false); }
  };

  const loadBanks = async () => {
    setBankBusy(true); setBankMsg(null);
    try {
      const r = await fetch("/api/banks").then((x) => x.json());
      if (r.ok) { setInstitutions(r.institutions || []); setConnected(r.connected || []); if (!r.institutions?.length) setBankMsg("Geen banken gevonden."); }
      else setBankMsg(r.error || "Mislukt.");
    } catch (e: any) { setBankMsg(e.message); } finally { setBankBusy(false); }
  };

  const connectBank = async () => {
    const inst = institutions.find((i) => i.id === chosenInst);
    if (!inst) return;
    setBankBusy(true); setBankMsg(null);
    try {
      const r = await fetch("/api/banks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ institutionId: inst.id, name: inst.name }) }).then((x) => x.json());
      if (r.ok && r.link) { window.open(r.link, "_blank"); setBankMsg("Log in bij je bank in het nieuwe tabblad en geef toestemming. Klik daarna op 'Synchroniseer banken'."); loadBanks(); }
      else setBankMsg(r.error || "Mislukt.");
    } catch (e: any) { setBankMsg(e.message); } finally { setBankBusy(false); }
  };

  const syncBanks = async () => {
    setBankBusy(true); setBankMsg(null);
    try {
      const r = await fetch("/api/banks/sync").then((x) => x.json());
      if (r.ok) {
        const lines = (r.results || []).map((x: any) => x.status === "OK" ? `${x.name}: ${x.balance != null ? eur(x.balance) + " · " : ""}${x.staged} nieuw · ${x.income} inkomend` : `${x.name}: ${x.note || x.error || x.status}`);
        setBankMsg(lines.join(" | ") || r.note || "Geen banken gekoppeld.");
        await refreshPending(); onReload && onReload();
      } else setBankMsg(r.error || "Mislukt.");
    } catch (e: any) { setBankMsg(e.message); } finally { setBankBusy(false); }
  };
  const [source, setSource] = useState("rabobank");
  const [psel, setPsel] = useState<Set<string>>(new Set());
  const togglePsel = (id: string) => setPsel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const SOURCE_OPTIONS = [
    ["rabobank", "Rabobank"], ["wise", "Wise"], ["revolut", "Revolut"],
    ["rabo_cc", "Rabo creditcard"], ["amex", "American Express"], ["paypal", "PayPal"], ["anders", "Anders"],
  ];

  // wachtrij ophalen bij openen (blijft staan na herladen)
  useEffect(() => {
    fetch(`/api/import`).then((r) => r.json()).then((r) => { if (r.ok) { setPending(r.pending || []); setIncome(r.income || []); } }).catch(() => {});
  }, []);

  const refreshPending = async () => {
    try { const r = await fetch(`/api/import`).then((x) => x.json()); if (r.ok) { setPending(r.pending || []); setIncome(r.income || []); } } catch {}
  };

  const upload = async (file: File) => {
    setBusy(true); setErr(null); setMsg(null); setRes(null);
    try {
      const text = await file.text();
      const r = await fetch(`/api/import?source=${source}`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: text }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error || "Import mislukt");
      setRes(r);
      setPending(r.pending || []);
      setIncome(r.income || []);
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const editCat = async (e: any, category: string) => {
    setPending((p) => p.map((x) => (x.id === e.id ? { ...x, category } : x)));
    try {
      await fetch(`/api/expense`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: e.id, mkey: e.mkey, category, remember: true }) });
      await refreshPending(); onReload && onReload();
    } catch {}
  };
  const editLabel = async (e: any, label: string) => {
    setPending((p) => p.map((x) => (x.id === e.id ? { ...x, label } : x)));
    try {
      await fetch(`/api/expense`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: e.id, mkey: e.mkey, label, remember: true }) });
      await refreshPending(); onReload && onReload();
    } catch {}
  };

  const approve = async (ids?: string[]) => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/import/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ids && ids.length ? { ids } : {}) }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error || "Goedkeuren mislukt");
      setPsel(new Set());
      await refreshPending();
      setMsg(`${r.approved} transactie(s) goedgekeurd en toegevoegd${r.revived ? ` · ${r.revived} hersteld` : ""}.`);
      onDone && onDone();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const discard = async () => {
    if (!confirm("Wachtrij verwerpen? Deze import gaat dan niet door.")) return;
    setBusy(true);
    try { await fetch(`/api/import?what=pending`, { method: "DELETE" }); setPending([]); setRes(null); setMsg("Wachtrij verworpen."); }
    finally { setBusy(false); }
  };

  const reset = async () => {
    if (!confirm("Alle reeds goedgekeurde geïmporteerde uitgaves verwijderen?")) return;
    setBusy(true);
    try { await fetch("/api/import", { method: "DELETE" }); onDone && onDone(); setMsg("Goedgekeurde import gewist."); } finally { setBusy(false); }
  };

  const pendingTotal = pending.reduce((a, e) => a + (["Transfer", "Privé"].includes(e.category) ? 0 : (e.bedrag || 0)), 0);

  return (
    <>
      <Card title="Automatische koppelingen" subtitle="haal saldo + transacties op zonder CSV">
        <p className="muted" style={{ marginTop: 0 }}>
          Koppel je rekeningen één keer; daarna haalt de app saldo én transacties automatisch op. Transacties komen in dezelfde wachtrij als je CSV's (met dedup, dus dubbel importeren kan geen kwaad).
        </p>

        <div className="vrow" style={{ alignItems: "center", marginBottom: 10 }}>
          <b style={{ width: 90 }}>PayPal</b>
          <button className="vadd" onClick={syncPaypal} disabled={ppBusy}>{ppBusy ? "Bezig…" : "↻ PayPal synchroniseren"}</button>
          {ppMsg && <span className="dim" style={{ fontSize: 13 }}>{ppMsg}</span>}
        </div>

        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}>
          <div className="ctrls" style={{ flexWrap: "wrap" }}>
            <b style={{ width: 90 }}>Banken</b>
            <button className="vadd" onClick={loadBanks} disabled={bankBusy}>Bank koppelen</button>
            {institutions.length > 0 && (
              <>
                <select className="msel" value={chosenInst} onChange={(e) => setChosenInst(e.target.value)}>
                  <option value="">— kies bank —</option>
                  {institutions.map((i: any) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
                <button className="vadd" onClick={connectBank} disabled={bankBusy || !chosenInst}>Koppel →</button>
              </>
            )}
            <button className="vadd" onClick={syncBanks} disabled={bankBusy}>{bankBusy ? "Bezig…" : "↻ Synchroniseer banken"}</button>
          </div>
          {connected.length > 0 && (
            <div className="dim" style={{ fontSize: 13, marginTop: 6 }}>Gekoppeld: {connected.map((c: any) => c.name).join(", ")}</div>
          )}
          {bankMsg && <div className="banner info" style={{ marginTop: 8 }}>{bankMsg}</div>}
        </div>
      </Card>

      <Card title="Bankafschrift importeren" subtitle="bank · creditcard · PayPal">
        <p className="muted" style={{ marginTop: 0 }}>
          Kies de bron en sleep je <b>CSV</b> hierheen. De import komt eerst in de <b>wachtrij</b> hieronder — die telt nog niet mee.
          Pas daar categorie en omschrijving aan en klik op <b>Goedkeuren</b> om ze definitief toe te voegen. Doe je niks, dan blijven ze staan.
        </p>
        <div className="ctrls" style={{ marginBottom: 12 }}>
          <span className="dim" style={{ fontSize: 13 }}>Bron:</span>
          <select className="msel" value={source} onChange={(e) => setSource(e.target.value)}>
            {SOURCE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <label className="dropzone">
          <input type="file" accept=".csv,text/csv" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
          <Upload size={22} />
          <span>{busy ? "Bezig…" : "Kies of sleep je CSV-bestand"}</span>
        </label>
        {err && <div className="banner err" style={{ marginTop: 12 }}>{err}</div>}
        {msg && <div className="banner ok" style={{ marginTop: 12 }}>{msg}</div>}
        {res?.note && <div className="banner warn" style={{ marginTop: 12 }}>{res.note}</div>}
        {res && (
          <>
            <div className="kpis" style={{ marginTop: 14 }}>
              <Kpi label="Herkend" value={String(res.parsed)} />
              <Kpi label="In wachtrij gezet" value={String(res.staged)} tone="up" />
              <Kpi label="Dubbel (overgeslagen)" value={String(res.duplicates)} />
              <Kpi label="Uitgesloten" value={String(res.stats?.excluded ?? 0)} tone="down" />
              <Kpi label="Transfers" value={String(res.stats?.transfers ?? 0)} />
              <Kpi label="Inkomend" value={String(res.stats?.income ?? 0)} />
              <Kpi label="Overgeslagen" value={String(res.stats?.skipped ?? 0)} tone={(res.stats?.skipped ?? 0) > 0 ? "down" : undefined} />
            </div>
            {(() => {
              const s = res.stats || {};
              const fx = res.fx || { converted: 0, failed: 0, dropped: 0 };
              const accounted = (res.parsed || 0) + (s.income || 0) + (s.excluded || 0) + (s.skipped || 0) + (fx.dropped || 0) + (fx.failed || 0);
              const total = s.total || 0;
              const ok = accounted === total;
              return (
                <div className={`banner ${ok && !fx.failed ? "info" : "warn"}`} style={{ marginTop: 12 }}>
                  <b>{total} regels in je CSV</b> = {res.parsed || 0} uitgaven + {s.income || 0} inkomend + {s.excluded || 0} uitgesloten + {s.skipped || 0} overgeslagen{ok ? " ✓ alles verwerkt" : ` — ${total - accounted} niet verklaard`}.
                  {(s.otherCurrency || 0) > 0 && <> Daarvan <b>{s.otherCurrency} niet-EUR</b> regels: {fx.converted} omgerekend naar EUR (dagkoers){fx.failed ? `, ${fx.failed} koers niet gevonden (overgeslagen)` : ""}.</>}
                  {(s.skipped ?? 0) > 0 && <> De <b>{s.skipped} overgeslagen</b> regels hadden geen herkenbare datum/bedrag.</>}
                </div>
              );
            })()}
            {Array.isArray(res.excluded) && res.excluded.length > 0 && (
              <details style={{ marginTop: 12 }}>
                <summary style={{ cursor: "pointer", fontWeight: 600 }}>Bekijk de {res.excluded.length} uitgesloten regels</summary>
                <p className="muted" style={{ margin: "6px 0" }}>
                  Deze zijn bewust niet als kost geteld omdat ze al elders meetellen (NicheBay = je COGS per order; Google/Meta = je advertentiekosten). Ziet iets er onterecht uit? Stuur me de omschrijving, dan haal ik 'm uit de uitsluitlijst.
                </p>
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Datum</th><th>Omschrijving</th><th>Reden (match)</th><th className="r">Bedrag</th></tr></thead>
                    <tbody>
                      {res.excluded.map((e: any, i: number) => (
                        <tr key={e.id || i}>
                          <td className="nowrap">{e.date ? ddmmyyyy(e.date) : "—"}</td>
                          <td title={e.omschrijving}>{e.omschrijving}</td>
                          <td><span className="pill pill-dim">{e.reason}</span></td>
                          <td className="r mono">{eur(e.bedrag)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </>
        )}
      </Card>

      {pending.length > 0 && (() => {
        const allSel = pending.length > 0 && pending.every((e: any) => psel.has(e.id));
        const toggleAll = () => { const n = new Set(psel); allSel ? pending.forEach((e: any) => n.delete(e.id)) : pending.forEach((e: any) => n.add(e.id)); setPsel(n); };
        return (
          <Card title="Wachtrij — nog niet meegeteld" subtitle={`${pending.length} regels · ${eur(pendingTotal)} · vink aan en keur goed`}>
            <div className="bulkbar" style={{ background: "var(--up-soft)", borderColor: "var(--up)", color: "var(--up)" }}>
              <span>{psel.size > 0 ? `${psel.size} geselecteerd` : `${pending.length} in wachtrij`}</span>
              {psel.size > 0 && <button className="bulkdel" style={{ background: "var(--up)" }} onClick={() => approve([...psel])} disabled={busy}>✓ Goedkeuren ({psel.size})</button>}
              <button className="bulkclear" onClick={() => approve()} disabled={busy}>Alles goedkeuren</button>
              <button className="bulkclear" onClick={discard} disabled={busy}>Verwerp</button>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr>
                  <th className="selcol"><input type="checkbox" checked={allSel} onChange={toggleAll} /></th>
                  <th>Datum</th><th>Omschrijving</th><th>Categorie</th><th className="r">Bedrag</th><th></th>
                </tr></thead>
                <tbody>
                  {pending.map((e: any, i: number) => (
                    <ExpenseRow key={e.id || i} e={e} cats={cats || []} selectable={true}
                      sel={psel.has(e.id)} onSel={() => togglePsel(e.id)}
                      show={(k: string) => ["date", "omschrijving", "category", "bedrag"].includes(k)}
                      onCat={editCat} onLabel={editLabel} onNote={() => {}} onApprove={(x: any) => approve([x.id])} />
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })()}

      {income.length > 0 && (() => {
        const real = income.filter((e: any) => e.category !== "Transfer");
        const transf = income.filter((e: any) => e.category === "Transfer");
        const totReal = real.reduce((a, e) => a + (e.bedrag || 0), 0);
        const totTransf = transf.reduce((a, e) => a + (e.bedrag || 0), 0);
        return (
          <Card title="Inkomend — geld dat binnenkwam" subtitle={`${income.length} regels · echt inkomend ${eur(totReal)} · eigen overboekingen ${eur(totTransf)}`}>
            <p className="muted" style={{ marginTop: 0 }}>
              Voor je cashflow (erin/eruit). Je kunt elke regel een categorie geven ("wegboeken"). Dit telt <b>niet</b> mee in je winst — je omzet komt uit Shopify. Markeer geld tussen je eigen rekeningen als <b>Transfer</b>.
            </p>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Datum</th><th>Omschrijving</th><th>Categorie</th><th className="r">Bedrag</th></tr></thead>
                <tbody>
                  {income.map((e: any, i: number) => {
                    const opts = ["Inkomsten", "Transfer", "Privé", ...(cats || []).filter((c: string) => !["Inkomsten", "Transfer", "Privé"].includes(c))];
                    return (
                      <tr key={e.id || i}>
                        <td className="nowrap">{e.date ? ddmmyyyy(e.date) : "—"}</td>
                        <td title={e.omschrijving}>{e.omschrijving}</td>
                        <td>
                          <select className="rowsel" value={e.category} onChange={(ev) => editIncome(e, ev.target.value)}>
                            {opts.map((c: string) => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </td>
                        <td className="r mono strong green">+{eur(e.bedrag)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })()}

      <button className="resetbtn" onClick={reset} disabled={busy} style={{ marginTop: 4 }}><Trash2 size={14} /> Goedgekeurde import wissen</button>
    </>
  );
}

function ExpenseRow({ e, cats, show, sel, onSel, onCat, onNote, onLabel, onApprove, selectable = true }: any) {
  const [note, setNote] = useState(e.note || "");
  const [label, setLabel] = useState(e.label || "");
  useEffect(() => { setNote(e.note || ""); }, [e.note, e.id]);
  useEffect(() => { setLabel(e.label || ""); }, [e.label, e.id]);
  const options: string[] = cats.includes(e.category) ? cats : [e.category, ...cats];
  return (
    <tr className={`${e.edited ? "edited" : ""} ${sel ? "selrow" : ""}`}>
      {selectable && <td className="selcol"><input type="checkbox" checked={!!sel} onChange={onSel} /></td>}
      {show("date") && <td className="nowrap">{e.date ? ddmmyyyy(e.date) : "—"}</td>}
      {show("omschrijving") && (
        <td>
          <input className="rowdesc" value={label} title={e.raw || ""} placeholder={e.raw || "omschrijving"}
            onChange={(ev) => setLabel(ev.target.value)}
            onBlur={() => { if (label !== (e.label || "")) onLabel(e, label); }}
            onKeyDown={(ev) => { if (ev.key === "Enter") (ev.target as HTMLInputElement).blur(); }} />
        </td>
      )}
      {show("category") && (
        <td>
          <select className="rowsel" value={e.category} onChange={(ev) => onCat(e, ev.target.value)}>
            {options.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </td>
      )}
      {show("note") && (
        <td>
          <input className="rownote" value={note} placeholder="notitie…"
            onChange={(ev) => setNote(ev.target.value)}
            onBlur={() => { if (note !== (e.note || "")) onNote(e, note); }}
            onKeyDown={(ev) => { if (ev.key === "Enter") (ev.target as HTMLInputElement).blur(); }} />
        </td>
      )}
      {show("methode") && <td className="dim">{e.methode}</td>}
      {show("bedrag") && <td className="r mono strong">{eur(e.bedrag)}</td>}
      {onApprove && <td className="r"><button className="rowok" title="Goedkeuren" onClick={() => onApprove(e)}>✓</button></td>}
    </tr>
  );
}

function Kpi({ label, value, tone }: any) {
  return (
    <div className={`kpi ${tone || ""}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value mono">{value}</div>
    </div>
  );
}
function Card({ title, subtitle, children }: any) {
  return (
    <section className="card">
      <div className="card-head"><h3>{title}</h3>{subtitle && <span>{subtitle}</span>}</div>
      <div className="card-body">{children}</div>
    </section>
  );
}
function TipCum({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  return <div className="tip"><div>{ddmmyyyy(payload[0].payload.date)}</div><b>{eur(payload[0].value)}</b></div>;
}
function TipDag({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return <div className="tip"><div>{ddmmyyyy(p.date)}</div><b className={p.dag >= 0 ? "green" : "red"}>{eur(p.dag)}</b></div>;
}
