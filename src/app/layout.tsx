import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Flow-State Quant Engine V8.2",
  description: "Flow-State Quant Engine V8.2",
};
import { NavigationHeader } from "@/components/NavigationHeader";
import { Analytics } from "@vercel/analytics/next"
import { AuthProvider } from "@/components/AuthProvider";
import { MarketDataProvider } from "@/context/MarketDataContext";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${inter.variable} font-sans antialiased bg-black text-white`}
      >
        <AuthProvider>
          <MarketDataProvider>
            <NavigationHeader />
            <main>{children}</main>
            <Analytics />
          </MarketDataProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
