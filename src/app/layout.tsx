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
  title: `Quegar Quant Engine V${SYSTEM_VERSION}`,
  description: `Quegar Quant Engine V${SYSTEM_VERSION}`,
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon-192.png",
    shortcut: "/icon-192.png",
    apple: "/icon-192.png",
  },
};
import { NavigationHeader } from "@/components/NavigationHeader";
import { AuthProvider } from "@/components/AuthProvider";
import { MarketDataProvider } from "@/context/MarketDataContext";
import { ThemeProvider } from "@/components/ThemeProvider";
import ThemeSync from "@/components/ThemeSync";
import Script from "next/script";

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
        <Script
          id="register-sw"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                var isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.startsWith('192.168.') || window.location.protocol === 'http:';
                if (!isLocal && window.location.protocol === 'https:') {
                  window.addEventListener('load', function() {
                    navigator.serviceWorker.register('/sw.js').catch(function(err) {
                      console.log('SW registration failed: ', err);
                    });
                  });
                } else {
                  // In local development / HTTP, unregister any stale service workers to prevent API/caching collisions
                  navigator.serviceWorker.getRegistrations().then(function(registrations) {
                    for (var r of registrations) {
                      r.unregister();
                    }
                  });
                }
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
            </MarketDataProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
