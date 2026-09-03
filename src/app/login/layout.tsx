import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign In · Quegar",
  description: "Quegar Portal Access Gate",
  robots: {
    index: false,
    follow: false,
  },
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
