import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { PlatformPreviewFrame } from "./components/PlatformPreviewFrame";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-face" });

export const metadata = {
  title: "Sales Intelligence",
  description: "Sales Call Intelligence by IGD",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className={`${inter.variable} ${mono.variable}`}><PlatformPreviewFrame />{children}</body>
    </html>
  );
}
