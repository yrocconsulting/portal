import localFont from "next/font/local";

/** Fonts for the client-facing report (Barlow, SIL Open Font License), stored locally like the portal's own. */
export const reportBody = localFont({
  variable: "--font-report-body",
  display: "swap",
  src: [
    { path: "../fonts/barlow-latin-400-normal.woff2", weight: "400" },
    { path: "../fonts/barlow-latin-500-normal.woff2", weight: "500" },
    { path: "../fonts/barlow-latin-600-normal.woff2", weight: "600" },
    { path: "../fonts/barlow-latin-700-normal.woff2", weight: "700" },
  ],
});

export const reportDisplay = localFont({
  variable: "--font-report-display",
  display: "swap",
  src: [
    { path: "../fonts/barlow-condensed-latin-600-normal.woff2", weight: "600" },
    { path: "../fonts/barlow-condensed-latin-700-normal.woff2", weight: "700" },
  ],
});
