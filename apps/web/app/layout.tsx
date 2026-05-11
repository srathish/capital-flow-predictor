import "./globals.css";
import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { AssistantDock } from "@/components/assistant-dock";
import { Nav } from "@/components/nav";
import { Providers } from "./providers";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const jbMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jb-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Bellwether",
  description: "Who's leading, who's lagging, and why — sector rotation and an agent ensemble for every ticker.",
};

const themeInitScript = `
(function() {
  try {
    var t = localStorage.getItem('theme') || 'dark';
    var root = document.documentElement;
    if (t === 'dark') root.classList.add('dark'); else root.classList.remove('dark');
    root.style.colorScheme = t;
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jbMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <Providers>
          <Nav />
          <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
          <AssistantDock />
        </Providers>
      </body>
    </html>
  );
}
