"use client";

import { useState, FormEvent, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock } from "lucide-react";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";

  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.replace(next);
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || "Inloggen mislukt.");
        setBusy(false);
      }
    } catch {
      setError("Netwerkfout. Probeer opnieuw.");
      setBusy(false);
    }
  }

  return (
    <div style={wrap}>
      <form onSubmit={onSubmit} style={card}>
        <div style={logo}>DM</div>
        <h1 style={title}>Drivemax Cockpit</h1>
        <p style={sub}>Log in om je P&amp;L te bekijken.</p>

        <label style={label}>
          <Lock size={14} style={{ opacity: 0.6 }} /> Wachtwoord
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          autoFocus
          style={input}
        />

        {error && <div style={errBox}>{error}</div>}

        <button type="submit" disabled={busy || !password} style={btn}>
          {busy ? "Bezig…" : "Inloggen"}
        </button>
      </form>
    </div>
  );
}

const wrap: React.CSSProperties = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  background: "var(--paper)",
  padding: 24,
};
const card: React.CSSProperties = {
  width: "100%",
  maxWidth: 360,
  background: "var(--card)",
  border: "1px solid var(--line)",
  borderRadius: 16,
  padding: "28px 26px",
  boxShadow: "0 8px 30px rgba(20,22,28,.06)",
  display: "flex",
  flexDirection: "column",
};
const logo: React.CSSProperties = {
  width: 46,
  height: 46,
  borderRadius: 12,
  background: "var(--ink)",
  color: "#fff",
  display: "grid",
  placeItems: "center",
  fontFamily: "'Space Grotesk', sans-serif",
  fontWeight: 700,
  fontSize: 16,
  marginBottom: 16,
};
const title: React.CSSProperties = {
  fontFamily: "'Space Grotesk', sans-serif",
  fontSize: 20,
  fontWeight: 700,
  margin: "0 0 4px",
  letterSpacing: "-.01em",
};
const sub: React.CSSProperties = {
  fontSize: 13.5,
  color: "var(--soft)",
  margin: "0 0 20px",
};
const label: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 12.5,
  fontWeight: 600,
  color: "var(--soft)",
  marginBottom: 7,
};
const input: React.CSSProperties = {
  font: "inherit",
  fontSize: 15,
  padding: "11px 13px",
  border: "1px solid var(--line)",
  borderRadius: 10,
  outline: "none",
  marginBottom: 16,
};
const errBox: React.CSSProperties = {
  background: "var(--down-soft)",
  border: "1px solid #F2C9C9",
  color: "#9A2222",
  fontSize: 13,
  borderRadius: 10,
  padding: "10px 12px",
  marginBottom: 14,
};
const btn: React.CSSProperties = {
  font: "inherit",
  fontSize: 15,
  fontWeight: 600,
  color: "#fff",
  background: "var(--accent)",
  border: "none",
  borderRadius: 10,
  padding: "12px 14px",
  cursor: "pointer",
};
