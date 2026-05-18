import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign In · Flow-State Quant Engine",
  description: "Institutional access gate for the Flow-State Quant Engine.",
};

/**
 * Login layout — intentionally does NOT include the NavigationHeader.
 * This gives the login page a clean, isolated full-screen appearance.
 */
export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
