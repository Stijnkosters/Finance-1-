import "./globals.css";

export const metadata = {
  title: "Drivemax Profit Cockpit",
  description: "Dagelijkse P&L met automatische COGS uit Shopify-orders",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <body>{children}</body>
    </html>
  );
}
