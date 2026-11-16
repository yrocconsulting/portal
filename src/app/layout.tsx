import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const inter = localFont({
  variable: "--font-inter",
  display: "swap",
  src: [
    { path: "../fonts/inter-latin-400-normal.woff2", weight: "400" },
    { path: "../fonts/inter-latin-500-normal.woff2", weight: "500" },
    { path: "../fonts/inter-latin-600-normal.woff2", weight: "600" },
    { path: "../fonts/inter-latin-700-normal.woff2", weight: "700" },
  ],
});

const interTight = localFont({
  variable: "--font-inter-tight",
  display: "swap",
  src: [
    { path: "../fonts/inter-tight-latin-600-normal.woff2", weight: "600" },
    { path: "../fonts/inter-tight-latin-700-normal.woff2", weight: "700" },
  ],
});

export const metadata: Metadata = {
  title: { default: "Yroc Portal", template: "%s | Yroc Portal" },
  description: "Yroc Consulting internal ticketing and client operations.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${interTight.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
