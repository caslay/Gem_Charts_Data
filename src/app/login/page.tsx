"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { SYSTEM_VERSION } from "@/lib/version";
import { QuegarBrandMark } from "@/components/brand/QuegarBrandMark";

function LoginContent() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/";
  const error = searchParams.get("error");
  const [isSigningIn, setIsSigningIn] = useState(false);

  const handleSignIn = async () => {
    if (isSigningIn) return;
    setIsSigningIn(true);
    try {
      await signIn("google", { callbackUrl });
    } catch (err) {
      console.error("[LOGIN] Sign in exception:", err);
      window.location.href = `/api/auth/signin/google?callbackUrl=${encodeURIComponent(callbackUrl)}`;
    }
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-4">
      {/* Ambient background glow */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-emerald-500/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-1/4 left-1/3 w-[400px] h-[400px] bg-cyan-500/5 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Card */}
        <div className="bg-zinc-950 border border-zinc-800/60 rounded-2xl p-8 shadow-2xl shadow-black/40 backdrop-blur-sm">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-zinc-900/80 border border-zinc-800/80 mb-5 shadow-2xl p-3">
              <QuegarBrandMark size={56} className="w-full h-full drop-shadow-[0_0_12px_rgba(0,240,255,0.25)]" />
            </div>
            <h1 className="text-2xl font-semibold text-white tracking-tight">
              Quegar Portal
            </h1>
            <p className="text-sm text-zinc-500 mt-2">
              Institutional access only. Sign in with your authorized Google
              account.
            </p>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="mb-6 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm text-center">
              {error === "AccessDenied" ? (
                <>
                  <span className="font-semibold">Access Denied.</span> Your
                  email is not whitelisted. Contact the administrator.
                </>
              ) : (
                <>
                  <span className="font-semibold">Authentication Error.</span>{" "}
                  Please try again.
                </>
              )}
            </div>
          )}

          {/* Google Sign-In Button */}
          <button
            id="google-sign-in-btn"
            onClick={handleSignIn}
            disabled={isSigningIn}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl bg-white text-black font-medium text-sm hover:bg-zinc-100 transition-all duration-200 cursor-pointer active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isSigningIn ? (
              <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
            ) : (
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
            )}
            {isSigningIn ? "Connecting to Google..." : "Sign in with Google"}
          </button>

          {/* Security Notice */}
          <div className="mt-6 pt-6 border-t border-zinc-800/60">
            <div className="flex items-start gap-2">
              <svg
                className="w-4 h-4 text-zinc-600 mt-0.5 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
                />
              </svg>
              <p className="text-xs text-zinc-600 leading-relaxed">
                This terminal is protected by email-based whitelisting. Only
                pre-approved Google accounts can access the dashboard.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-zinc-700 mt-6">
          Quegar Core V{SYSTEM_VERSION} · Secure Access
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-black flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
