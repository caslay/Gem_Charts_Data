import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Flow-State Quant Engine V9.0",
  description: "Flow-State Quant Engine V9.0",
};
import { NavigationHeader } from "@/components/NavigationHeader";
import { Analytics } from "@vercel/analytics/next"
import { AuthProvider } from "@/components/AuthProvider";
import { MarketDataProvider } from "@/context/MarketDataContext";
import { ThemeProvider } from "@/components/ThemeProvider";
import ThemeSync from "@/components/ThemeSync";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased bg-background text-foreground transition-colors duration-300`}
      >
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          <AuthProvider>
            <MarketDataProvider>
              <ThemeSync />
              <NavigationHeader />
              <main>{children}</main>
              <Analytics />
            </MarketDataProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
