import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Flow-State Quant Engine V8.0",
  description: "Flow-State Quant Engine V8.0",
};
import { NavigationHeader } from "@/components/NavigationHeader";

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
        <NavigationHeader />
        <main>{children}</main>
      </body>
    </html>
  );
}
