import type { Metadata } from "next";
import "@fontsource-variable/montserrat/wght.css";
import "@fontsource-variable/roboto/wght.css";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("http://localhost:3000"),
  title: "AI Chef | Effiwaste",
  description: "Recetas profesionales de reaprovechamiento con Effiwaste AI Chef.",
  openGraph: {
    title: "AI Chef | Effiwaste",
    description: "Aprovecha más. Desperdicia menos.",
    images: [{ url: "/og.png", width: 1536, height: 1024 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Chef | Effiwaste",
    description: "Aprovecha más. Desperdicia menos.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
