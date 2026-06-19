"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine, Cell,
} from "recharts";
import { TrendingUp, TrendingDown, LayoutDashboard, CalendarDays, Receipt, Wallet, RefreshCw } from "lucide-react";

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

export default function Dashboard() {
  const [tab, setTab] = useState("overzicht");
  const [period, setPeriod] = useState("maand");
  const [pl, setPl] = useState<any>(null);
  const [data, setData] = useState<any>({ expenses: [], liquid: [], openInvoices: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const { from, to } = rangeFor(period);
      const [r1, r2] = await Promise.all([
        fetch(`/api/pl?from=${from}&to=${to}`).then((r) => r.json()),
        fetch(`/api/data`).then((r) => r.json()),
      ]);
      if (!r1.ok) throw new Error(r1.error || "P&L ophalen mislukt");
      setPl(r1); setData(r2);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [period]);

  const days = pl?.days || [];
  const totals = pl?.totals || {};

  const expensesInRange = useMemo(() => {
    if (!pl) return [];
    const { from, to } = pl.range;
    return (data.expenses || []).filter((e: any) => e.date >= from && e.date <= to);
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
          ["balans", "Balans", Wallet],
        ].map(([k, label, Icon]: any) => (
          <button key={k} className={`tab ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>
            <Icon size={16} /> {label}
          </button>
        ))}
      </nav>

      <main className="main">
        <div className="row-between">
          <h2 className="h2">{tab === "overzicht" ? "Overzicht" : tab === "pl" ? "Dagelijkse P&L" : tab === "uitgaves" ? "Uitgaves" : "Balans"}</h2>
          <div className="seg">
            {[["vandaag", "Vandaag"], ["week", "Week"], ["maand", "30d"], ["kwartaal", "90d"]].map(([v, l]) => (
              <button key={v} className={period === v ? "on" : ""} onClick={() => setPeriod(v)}>{l}</button>
            ))}
          </div>
        </div>

        {error && <div className="banner err">Fout: {error}. Check je env vars (SHOPIFY_STORE_DOMAIN / SHOPIFY_ADMIN_TOKEN) in Vercel.</div>}
        {loading && <div className="loading">Orders ophalen uit Shopify…</div>}

        {!loading && !error && pl && (
          <>
            {pl.adWarning && tab === "overzicht" && (
              <div className="banner warn">{pl.adWarning}</div>
            )}
            {pl.missingCosts?.length > 0 && tab === "overzicht" && (
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
                  <Kpi label="COGS (auto)" value={eur(totals.cogs || 0)} tone="down" />
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

            {tab === "uitgaves" && (
              <Card title="Uitgaves" subtitle="uit expenses.json">
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Datum</th><th>Omschrijving</th><th>Methode</th><th className="r">Bedrag</th></tr></thead>
                    <tbody>
                      {(data.expenses || []).length === 0 && <tr><td colSpan={4} className="dim center">Geen uitgaves.</td></tr>}
                      {(data.expenses || []).map((e: any, i: number) => (
                        <tr key={i}>
                          <td className="nowrap">{ddmmyyyy(e.date)}</td>
                          <td>{e.omschrijving}</td>
                          <td className="dim">{e.methode}</td>
                          <td className="r mono strong">{eur(e.bedrag)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {tab === "balans" && (
              <div className="grid2">
                <Card title="Liquide middelen">
                  <div className="cash">
                    {(data.liquid || []).map((r: any, i: number) => (
                      <div className="cash-row" key={i}><span>{r.name}</span><b className="mono">{eur(r.amount)}</b></div>
                    ))}
                    <div className="cash-div" />
                    <div className="cash-row big"><span>Totaal</span><b className="mono">{eur(liquid)}</b></div>
                  </div>
                </Card>
                <Card title="Openstaande facturen">
                  <div className="cash">
                    {(data.openInvoices || []).map((r: any, i: number) => (
                      <div className="cash-row" key={i}><span>{r.name}</span><b className="mono amber">{eur(r.amount)}</b></div>
                    ))}
                    <div className="cash-div" />
                    <div className="cash-row big"><span>Totaal due</span><b className="mono amber">{eur(due)}</b></div>
                  </div>
                </Card>
              </div>
            )}
          </>
        )}
      </main>
    </div>
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
