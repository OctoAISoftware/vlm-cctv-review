import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Qwen3.5 CCTV Review",
  description: "Curated review of Qwen3.5 captions vs Octave's event_class library",
};

// Phone-friendly: zoom permitted, but the layout already adapts down to ~360px
// so the page never needs the user to pinch-zoom for legibility.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b0d10",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-border px-3 sm:px-6 py-3 flex flex-wrap items-center gap-x-6 gap-y-2 bg-surface">
          <Link href="/" className="font-semibold text-text whitespace-nowrap">
            <span className="text-accent">Qwen3.5</span> CCTV Review
          </Link>
          <nav className="flex items-center gap-3 text-sm">
            <Link href="/" className="text-muted hover:text-accent">Dashboard</Link>
            <Link href="/random" className="text-muted hover:text-accent">Random</Link>
          </nav>
          <span className="hidden md:inline text-muted text-sm">
            Curate which event_class matches each caption — feeds back into Octave's library.
          </span>
        </header>
        <main className="px-3 sm:px-6 py-4 sm:py-6">{children}</main>
      </body>
    </html>
  );
}
