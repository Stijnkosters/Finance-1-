"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine, Cell,
} from "recharts";
import { TrendingUp, TrendingDown, LayoutDashboard, CalendarDays, Receipt, Wallet, RefreshCw, Upload, Trash2 } from "lucide-react";

const eur = (n: number) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(n || 0);
const numf = (n: number, d = 2) => new Intl.NumberFormat("nl-NL", { minimumFractionDigits: d, maximumFractionDigits: d }).format(n || 0);
const pctf = (n: number) => `${(n * 100).toFixed(1).replace(".", ",")}%`;
const ddmm = (iso: string) => { const [, m, d] = iso.split("-"); return `${d}-${m}`; };
const ddmmyyyy = (iso: string) => { const [y, m, d] = iso.split("-"); return `${d}-${m}-${y}`; };

function rangeFor(period: string) {
  const to = new Date();
  const from = new Date();
  if (period === "vandaag") { /* same day */ }
  else if (period === "week") from.setDate(to.getDate() - 6);
  else if (period === "maand") from.setDate(to.getDate() - 29);
  else if (period === "kwartaal") from.setDate(to.getDate() - 89);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
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
  const [period, setPeriod] = useState("maand");
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

  const NON_COST = ["Transfer", "Privé"];
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
                {[["vandaag", "Vandaag"], ["week", "Week"], ["maand", "30d"], ["kwartaal", "90d"]].map(([v, l]) => (
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
                          <ExpenseRow key={e.id || i} e={e} cats={data.categories || []} show={showCol}
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

        {tab === "balans" && <VermogenPanel />}

        {tab === "import" && <ImportPanel onDone={load} onReload={reloadData} cats={data.categories || []} />}
      </main>
    </div>
  );
}

function VermogenPanel() {
  const [assets, setAssets] = useState<any[]>([]);
  const [liab, setLiab] = useState<any[]>([]);
  const [snaps, setSnaps] = useState<any[]>([]);
  const [captured, setCaptured] = useState<any>({});
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [persisted, setPersisted] = useState(true);
  const [saved, setSaved] = useState(false);

  const load = async () => {
    try {
      const r = await fetch("/api/vermogen").then((x) => x.json());
      if (r.ok) { setAssets(r.assets || []); setLiab(r.liabilities || []); setSnaps(r.snapshots || []); setCaptured(r.captured || {}); setPersisted(r.persisted !== false); }
    } catch {}
  };
  useEffect(() => { load(); }, []);

  const save = async (a = assets, l = liab) => {
    try {
      await fetch("/api/vermogen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assets: a, liabilities: l }) });
      setSaved(true); setTimeout(() => setSaved(false), 1200);
    } catch {}
  };

  const edit = (which: "a" | "l", i: number, field: string, value: any) => {
    if (which === "a") setAssets((rows) => rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
    else setLiab((rows) => rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
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
    return key ? { key, ...captured[key] } : null;
  };

  const rows = (which: "a" | "l", list: any[]) => (
    <div className="cash">
      {list.map((r, i) => {
        const cap = which === "a" ? capturedFor(r.name) : null;
        return (
          <div className="vrow" key={i}>
            <input className="vname" value={r.name} placeholder="naam" onChange={(e) => edit(which, i, "name", e.target.value)} onBlur={() => save()} />
            <input className="vamt mono" type="number" value={r.amount} onChange={(e) => edit(which, i, "amount", e.target.value)} onBlur={() => save()} />
            <button className="vdel" onClick={() => removeRow(which, i)} title="Verwijderen">×</button>
            {cap && (
              <button className="vcap" title={`Saldo uit import (${ddmmyyyy(cap.date)})`}
                onClick={() => { edit(which, i, "amount", cap.amount); setTimeout(() => save(), 0); }}>
                uit import: {eur(cap.amount)} ↺
              </button>
            )}
          </div>
        );
      })}
      <button className="vadd" onClick={() => addRow(which)}>+ regel</button>
    </div>
  );

  return (
    <>
      {!persisted && <div className="banner warn">Geen opslag actief — zet DATA_DIR + Railway Volume, anders wordt je vermogen niet bewaard.</div>}

      <div className={`hero ${net >= 0 ? "up" : "down"}`} style={{ marginBottom: 18, gridTemplateColumns: "1fr" }}>
        <div>
          <div className="hero-label">NETTO VERMOGEN</div>
          <div className="hero-value">{net >= 0 ? <TrendingUp size={30} /> : <TrendingDown size={30} />} {eur(net)}</div>
          <div className="hero-note">Bezittingen {eur(aTot)} − schulden {eur(lTot)}.{saved ? " ✓ opgeslagen" : ""}</div>
        </div>
      </div>

      <div className="grid2">
        <Card title="Bezittingen" subtitle={eur(aTot)}>{rows("a", assets)}</Card>
        <Card title="Schulden" subtitle={eur(lTot)}>{rows("l", liab)}</Card>
      </div>

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
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [source, setSource] = useState("rabobank");

  const SOURCE_OPTIONS = [
    ["rabobank", "Rabobank"], ["wise", "Wise"], ["revolut", "Revolut"],
    ["rabo_cc", "Rabo creditcard"], ["amex", "American Express"], ["paypal", "PayPal"], ["anders", "Anders"],
  ];

  // wachtrij ophalen bij openen (blijft staan na herladen)
  useEffect(() => {
    fetch(`/api/import`).then((r) => r.json()).then((r) => { if (r.ok) setPending(r.pending || []); }).catch(() => {});
  }, []);

  const refreshPending = async () => {
    try { const r = await fetch(`/api/import`).then((x) => x.json()); if (r.ok) setPending(r.pending || []); } catch {}
  };

  const upload = async (file: File) => {
    setBusy(true); setErr(null); setMsg(null); setRes(null);
    try {
      const text = await file.text();
      const r = await fetch(`/api/import?source=${source}`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: text }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error || "Import mislukt");
      setRes(r);
      setPending(r.pending || []);
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

  const approve = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/import/approve`, { method: "POST" }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error || "Goedkeuren mislukt");
      setPending([]); setRes(null);
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
          <div className="kpis" style={{ marginTop: 14 }}>
            <Kpi label="Herkend" value={String(res.parsed)} />
            <Kpi label="In wachtrij gezet" value={String(res.staged)} tone="up" />
            <Kpi label="Dubbel (overgeslagen)" value={String(res.duplicates)} />
            <Kpi label="Uitgesloten" value={String(res.stats?.excluded ?? 0)} tone="down" />
            <Kpi label="Transfers" value={String(res.stats?.transfers ?? 0)} />
            <Kpi label="Inkomend" value={String(res.stats?.income ?? 0)} />
          </div>
        )}
      </Card>

      {pending.length > 0 && (
        <Card title="Wachtrij — nog niet meegeteld" subtitle={`${pending.length} regels · ${eur(pendingTotal)} · pas aan en keur goed`}>
          <div className="bulkbar" style={{ background: "var(--up-soft)", borderColor: "var(--up)", color: "var(--up)" }}>
            <span>{pending.length} regel(s) in wachtrij</span>
            <button className="bulkdel" style={{ background: "var(--up)" }} onClick={approve} disabled={busy}>✓ Goedkeuren &amp; toevoegen</button>
            <button className="bulkclear" onClick={discard} disabled={busy}>Verwerp</button>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Datum</th><th>Omschrijving</th><th>Categorie</th><th className="r">Bedrag</th></tr></thead>
              <tbody>
                {pending.map((e: any, i: number) => (
                  <ExpenseRow key={e.id || i} e={e} cats={cats || []} selectable={false}
                    show={(k: string) => ["date", "omschrijving", "category", "bedrag"].includes(k)}
                    onCat={editCat} onLabel={editLabel} onNote={() => {}} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <button className="resetbtn" onClick={reset} disabled={busy} style={{ marginTop: 4 }}><Trash2 size={14} /> Goedgekeurde import wissen</button>
    </>
  );
}

function ExpenseRow({ e, cats, show, sel, onSel, onCat, onNote, onLabel, selectable = true }: any) {
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
