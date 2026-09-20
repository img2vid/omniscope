import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ACCENT_RESTORE_SCRIPT } from "@/lib/accent";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Omniscope — Universal File Lab · open 10,000+ formats client-side",
  description:
    "A fully client-side universal file viewer. Open and inspect 10,000+ file format identities — images, audio, video, documents, archives, fonts, 3D, databases, ROMs — entirely in your browser. No uploads, no servers.",
  keywords: ["file viewer", "file format", "hex viewer", "magic bytes", "client-side", "GitHub Pages"],
  authors: [{ name: "Omniscope" }],
  openGraph: {
    title: "Omniscope — Universal File Lab",
    description: "Open anything. Understand every byte. 10,000+ formats, zero servers.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-zinc-950 text-zinc-100`}
      >
        {/* restore persisted accent before first paint (runs synchronously at parse time) */}
        <script dangerouslySetInnerHTML={{ __html: ACCENT_RESTORE_SCRIPT }} />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
