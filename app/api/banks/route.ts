import { NextResponse } from "next/server";
import { gcConfigured, gcInstitutions, gcCreateRequisition, guessSourceKey } from "@/lib/gocardless";
import { readJson, writeJson, persistenceEnabled } from "@/lib/store";

export const dynamic = "force-dynamic";

// GET = lijst met banken + reeds gekoppelde verbindingen
export async function GET(req: Request) {
  if (!gcConfigured()) {
    return NextResponse.json({ ok: false, error: "GC_SECRET_ID / GC_SECRET_KEY ontbreken. Maak gratis aan op bankaccountdata.gocardless.com." }, { status: 400 });
  }
  try {
    const wanted = (new URL(req.url).searchParams.get("filter") || "").toLowerCase();
    let institutions = await gcInstitutions("nl");
    // toon vooral de relevante banken bovenaan
    const prio = ["american express", "rabobank", "revolut"];
    institutions.sort((a: any, b: any) => {
      const ai = prio.findIndex((p) => a.name.toLowerCase().includes(p));
      const bi = prio.findIndex((p) => b.name.toLowerCase().includes(p));
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
    if (wanted) institutions = institutions.filter((i: any) => i.name.toLowerCase().includes(wanted));
    const connected = await readJson("requisitions.json", []);
    return NextResponse.json({ ok: true, institutions, connected });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// POST { institutionId, name } = start koppeling, geef toestemmings-link terug
export async function POST(req: Request) {
  if (!gcConfigured()) return NextResponse.json({ ok: false, error: "GoCardless niet geconfigureerd." }, { status: 400 });
  try {
    const body = await req.json();
    const origin = new URL(req.url).origin;
    const redirect = `${origin}/?bank=connected`;
    const reference = `dmx-${Date.now()}`;
    const r = await gcCreateRequisition(body.institutionId, redirect, reference);
    if (persistenceEnabled()) {
      const reqs = await readJson("requisitions.json", []);
      const sourceKey = guessSourceKey(body.name || "");
      const filtered = reqs.filter((x: any) => x.institutionId !== body.institutionId);
      filtered.push({ id: r.id, institutionId: body.institutionId, name: body.name || "", sourceKey, createdAt: new Date().toISOString() });
      await writeJson("requisitions.json", filtered);
    }
    return NextResponse.json({ ok: true, link: r.link, id: r.id });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// DELETE = verwijder een koppeling uit de lijst
export async function DELETE(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get("id");
    const reqs = await readJson("requisitions.json", []);
    await writeJson("requisitions.json", reqs.filter((x: any) => x.id !== id));
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
