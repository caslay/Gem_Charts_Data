import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SYSTEM_VERSION } from "@/lib/version";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: `Flow-State Quant Engine V${SYSTEM_VERSION}`,
  description: `Flow-State Quant Engine V${SYSTEM_VERSION}`,
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon-192.png",
    shortcut: "/icon-192.png",
    apple: "/icon-192.png",
  },
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
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js').catch(function(err) {
                    console.log('SW registration failed: ', err);
                  });
                });
              }
            `,
          }}
        />
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
