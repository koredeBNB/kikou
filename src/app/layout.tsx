import type { Metadata, Viewport } from "next";
import { Fredoka, Geist_Mono, Nunito } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BRAND_NAME, BRAND_TAGLINE } from "@/lib/brand";
import { cn } from "@/lib/utils";
import "./globals.css";

const display = Fredoka({ subsets: ["latin"], variable: "--font-display", weight: ["400", "500", "600", "700"] });
const body = Nunito({ subsets: ["latin"], variable: "--font-body" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: { default: `${BRAND_NAME} · ${BRAND_TAGLINE}`, template: `%s · ${BRAND_NAME}` },
  applicationName: BRAND_NAME,
  description: `${BRAND_TAGLINE} ${BRAND_NAME} asks ChatGPT, Claude, Gemini and Perplexity the questions your buyers ask. See how often you're recommended, where you rank, and which sources they cite.`,
};

export const viewport: Viewport = {
  themeColor: "#c3e3f6",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={cn("h-full antialiased", display.variable, body.variable, mono.variable)}>
      <body className="min-h-full font-sans">
        <TooltipProvider delayDuration={150}>{children}</TooltipProvider>
        <Toaster position="top-center" />
      </body>
    </html>
  );
}
