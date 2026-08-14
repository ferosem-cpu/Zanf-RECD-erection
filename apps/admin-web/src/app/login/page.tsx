"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import { useAuth } from "@/components/AuthContext";
import { api } from "@/lib/apiClient";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: { client_id: string; callback: (response: { credential: string }) => void; use_fedcm_for_button?: boolean; auto_select?: boolean; context?: string }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

type Tab = "staff" | "customer" | "vendor";

const inputCls =
  "w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)]/30 focus:border-[var(--theme-accent)] transition";
const labelCls = "block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1";

export default function LoginPage() {
  const { login } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("staff");

  // Staff Login State
  const [email, setEmail] = useState("owner@example.com");
  const [password, setPassword] = useState("changeme123");
  const [staffError, setStaffError] = useState<string | null>(null);
  const [staffLoading, setStaffLoading] = useState(false);

  // Google sign-in (additional staff login method)
  const googleButtonRef = useRef<HTMLDivElement>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);

  async function handleGoogleCredential(response: { credential: string }) {
    setGoogleError(null);
    try {
      const result = await api<{ token: string; user: { name: string } }>("/auth/google", {
        method: "POST",
        body: JSON.stringify({ credential: response.credential }),
      });
      await login(result.token);
    } catch (err) {
      setGoogleError(err instanceof Error ? err.message : "Google sign-in failed");
    }
  }

  function initGoogleButton() {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId || !window.google || !googleButtonRef.current) return;
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: handleGoogleCredential,
      // Disable the FedCM-personalized button so it doesn't show whichever Google
      // account happens to already be signed into the browser ("Sign in as X") -
      // that account may not be the person actually using this shared login page.
      // Falls back to a neutral "Sign in with Google" button for everyone.
      use_fedcm_for_button: false,
      auto_select: false,
      context: "signin",
    });
    window.google.accounts.id.renderButton(googleButtonRef.current, { theme: "outline", size: "large", width: 300, text: "signin_with" });
  }

  useEffect(() => {
    // The GSI script may already be loaded/cached from a previous visit, in which case
    // next/script's onLoad won't fire again - so also try once on mount.
    initGoogleButton();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Vendor Registration State
  const [vendor, setVendor] = useState({ name: "", contactName: "", contactEmail: "", contactPhone: "", address: "" });
  const [vendorError, setVendorError] = useState<string | null>(null);
  const [vendorLoading, setVendorLoading] = useState(false);
  const [vendorDone, setVendorDone] = useState(false);
  const [vendorTabMode, setVendorTabMode] = useState<"register" | "signin">("register");

  // Email + OTP sign-in - shared by the Customer tab and the Vendor tab's
  // "Sign in" mode. Same backend endpoints (/auth/email-otp/request|verify) work for both:
  // any active customer contact, or any approved vendor's engineer.
  const [emailOtpAddress, setEmailOtpAddress] = useState("");
  const [emailOtpCode, setEmailOtpCode] = useState("");
  const [emailOtpSent, setEmailOtpSent] = useState(false);
  const [emailOtpMessage, setEmailOtpMessage] = useState<string | null>(null);
  const [emailOtpError, setEmailOtpError] = useState<string | null>(null);
  const [emailOtpLoading, setEmailOtpLoading] = useState(false);

  function clearErrors() {
    setStaffError(null);
    setVendorError(null);
    setEmailOtpError(null);
  }

  async function handleStaffSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStaffLoading(true);
    setStaffError(null);
    try {
      const result = await api<{ token: string; user: { name: string } }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      await login(result.token);
    } catch (err) {
      setStaffError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setStaffLoading(false);
    }
  }

  async function handleVendorRegister(e: React.FormEvent) {
    e.preventDefault();
    setVendorLoading(true);
    setVendorError(null);
    try {
      await api("/vendors/register", {
        method: "POST",
        body: JSON.stringify({
          name: vendor.name,
          contactName: vendor.contactName,
          contactEmail: vendor.contactEmail,
          contactPhone: vendor.contactPhone || undefined,
          address: vendor.address || undefined,
        }),
      });
      setVendorDone(true);
    } catch (err) {
      setVendorError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setVendorLoading(false);
    }
  }

  async function handleEmailOtpRequest(e: React.FormEvent) {
    e.preventDefault();
    setEmailOtpLoading(true);
    setEmailOtpError(null);
    setEmailOtpMessage(null);
    try {
      const result = await api<{ ok: boolean; message: string; devCode?: string }>("/auth/email-otp/request", {
        method: "POST",
        body: JSON.stringify({ email: emailOtpAddress }),
      });
      setEmailOtpSent(true);
      // In production the code only arrives by email; in dev the API echoes it back so we can test.
      setEmailOtpMessage(result.devCode ?? null);
    } catch (err) {
      setEmailOtpError(err instanceof Error ? err.message : "Failed to send OTP");
    } finally {
      setEmailOtpLoading(false);
    }
  }

  async function handleEmailOtpVerify(e: React.FormEvent) {
    e.preventDefault();
    setEmailOtpLoading(true);
    setEmailOtpError(null);
    try {
      const result = await api<{ token: string; user: { name: string } }>("/auth/email-otp/verify", {
        method: "POST",
        body: JSON.stringify({ email: emailOtpAddress, code: emailOtpCode }),
      });
      await login(result.token);
    } catch (err) {
      setEmailOtpError(err instanceof Error ? err.message : "OTP verification failed");
    } finally {
      setEmailOtpLoading(false);
    }
  }

  function resetEmailOtp() {
    setEmailOtpAddress("");
    setEmailOtpCode("");
    setEmailOtpSent(false);
    setEmailOtpMessage(null);
    setEmailOtpError(null);
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "staff", label: "Staff Login" },
    { key: "customer", label: "Customer" },
    { key: "vendor", label: "Vendor" },
  ];

  return (
    <div className="flex min-h-[90vh] items-center justify-center p-4" data-testid="login-page">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 shadow-xl">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">RECD Tracker</h1>
          <p className="mt-2 text-sm text-gray-500">Project & Service Management System</p>
        </div>

        {/* Tab Headers */}
        <div className="flex border-b border-gray-100 mb-6">
          {tabs.map((t) => (
            <button
              key={t.key}
              data-testid={`login-tab-${t.key}`}
              onClick={() => {
                setActiveTab(t.key);
                clearErrors();
              }}
              className={`flex-1 pb-3 text-xs sm:text-sm font-semibold border-b-2 transition-colors ${
                activeTab === t.key
                  ? "border-[var(--theme-accent)] text-gray-900"
                  : "border-transparent text-gray-400 hover:text-gray-600"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Staff Sign In Tab */}
        {activeTab === "staff" && (
          <form onSubmit={handleStaffSubmit} className="space-y-4">
            <div>
              <label className={labelCls}>Email</label>
              <input type="email" required className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Password</label>
              <input type="password" required className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {staffError && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{staffError}</div>}
            <button type="submit" disabled={staffLoading} className="btn-primary w-full py-2.5 text-sm font-semibold disabled:opacity-50">
              {staffLoading ? "Signing in..." : "Sign in"}
            </button>

            {process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID && (
              <>
                <div className="flex items-center gap-3 pt-1">
                  <div className="h-px flex-1 bg-gray-200" />
                  <span className="text-xs text-gray-400">or</span>
                  <div className="h-px flex-1 bg-gray-200" />
                </div>
                {googleError && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{googleError}</div>}
                <div className="flex justify-center" data-testid="google-signin-button" ref={googleButtonRef} />
                <Script
                  src="https://accounts.google.com/gsi/client"
                  strategy="afterInteractive"
                  onLoad={initGoogleButton}
                />
              </>
            )}
          </form>
        )}

        {/* Customer Tab - Email + OTP only for now */}
        {activeTab === "customer" && (
          <div className="space-y-4">
            {!emailOtpSent ? (
              <form onSubmit={handleEmailOtpRequest} className="space-y-4">
                <div>
                  <label className={labelCls}>Email</label>
                  <input type="email" required placeholder="you@example.com" className={inputCls} value={emailOtpAddress} onChange={(e) => setEmailOtpAddress(e.target.value)} />
                </div>
                {emailOtpError && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{emailOtpError}</div>}
                <button type="submit" disabled={emailOtpLoading} className="btn-primary w-full py-2.5 text-sm font-semibold disabled:opacity-50">
                  {emailOtpLoading ? "Sending OTP..." : "Get One-Time Password"}
                </button>
              </form>
            ) : (
              <form onSubmit={handleEmailOtpVerify} className="space-y-4">
                {emailOtpMessage ? (
                  <div className="rounded-lg bg-amber-50 border border-amber-100 p-3 text-sm text-amber-800">
                    <p className="font-medium">Dev mode - OTP (delivered by email in production):</p>
                    <p className="mt-1 font-mono font-bold text-base tracking-wider">{emailOtpMessage}</p>
                  </div>
                ) : (
                  <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-3 text-sm text-emerald-800">
                    If that email is registered, a 6-digit code has been sent to it.
                  </div>
                )}
                <div>
                  <label className={labelCls}>Enter 6-digit OTP</label>
                  <input type="text" required maxLength={6} placeholder="123456" className={`${inputCls} font-mono tracking-widest text-center`} value={emailOtpCode} onChange={(e) => setEmailOtpCode(e.target.value)} />
                </div>
                {emailOtpError && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{emailOtpError}</div>}
                <div className="flex gap-2">
                  <button type="button" onClick={() => { setEmailOtpSent(false); setEmailOtpCode(""); }} className="flex-1 rounded-xl border border-gray-300 px-3 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors">
                    Back
                  </button>
                  <button type="submit" disabled={emailOtpLoading} className="flex-[2] btn-primary py-2.5 text-sm font-semibold disabled:opacity-50">
                    {emailOtpLoading ? "Verifying..." : "Verify & Sign In"}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* Vendor Registration Tab */}
        {activeTab === "vendor" && (
          <div className="space-y-4" data-testid="vendor-register-form">
            {vendorDone ? (
              <div className="space-y-3 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-600">
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                </div>
                <p className="text-sm text-gray-700">
                  Thanks — your registration was submitted. Zan-F management will review it and, once approved,
                  email login details to <strong>{vendor.contactEmail}</strong>.
                </p>
                <button
                  type="button"
                  onClick={() => { setVendorDone(false); setVendor({ name: "", contactName: "", contactEmail: "", contactPhone: "", address: "" }); }}
                  className="text-xs font-medium text-[var(--theme-accent)]"
                >
                  Register another company
                </button>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => { setVendorTabMode("register"); resetEmailOtp(); clearErrors(); }}
                    className={`flex-1 rounded-lg py-1.5 text-xs font-semibold border transition-colors ${
                      vendorTabMode === "register"
                        ? "border-[var(--theme-accent)] bg-[var(--theme-accent-light)] text-[var(--theme-primary)]"
                        : "border-gray-200 text-gray-400 hover:text-gray-600"
                    }`}
                  >
                    Register
                  </button>
                  <button
                    type="button"
                    onClick={() => { setVendorTabMode("signin"); resetEmailOtp(); clearErrors(); }}
                    className={`flex-1 rounded-lg py-1.5 text-xs font-semibold border transition-colors ${
                      vendorTabMode === "signin"
                        ? "border-[var(--theme-accent)] bg-[var(--theme-accent-light)] text-[var(--theme-primary)]"
                        : "border-gray-200 text-gray-400 hover:text-gray-600"
                    }`}
                  >
                    Sign in
                  </button>
                </div>

                {vendorTabMode === "register" ? (
                  <form onSubmit={handleVendorRegister} className="space-y-4">
                    <p className="rounded-lg bg-gray-50 border border-gray-100 p-3 text-xs text-gray-600">
                      Erection vendor? Register your company for approval. <strong>Already approved?</strong> Use the
                      "Sign in" tab above with your email.
                    </p>
                    <div>
                      <label className={labelCls}>Company name</label>
                      <input required className={inputCls} value={vendor.name} onChange={(e) => setVendor({ ...vendor, name: e.target.value })} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={labelCls}>Contact name</label>
                        <input required className={inputCls} value={vendor.contactName} onChange={(e) => setVendor({ ...vendor, contactName: e.target.value })} />
                      </div>
                      <div>
                        <label className={labelCls}>Contact phone</label>
                        <input className={inputCls} value={vendor.contactPhone} onChange={(e) => setVendor({ ...vendor, contactPhone: e.target.value })} />
                      </div>
                    </div>
                    <div>
                      <label className={labelCls}>Contact email (your login)</label>
                      <input required type="email" className={inputCls} value={vendor.contactEmail} onChange={(e) => setVendor({ ...vendor, contactEmail: e.target.value })} />
                    </div>
                    <div>
                      <label className={labelCls}>Address</label>
                      <input className={inputCls} value={vendor.address} onChange={(e) => setVendor({ ...vendor, address: e.target.value })} />
                    </div>
                    {vendorError && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{vendorError}</div>}
                    <button type="submit" disabled={vendorLoading} className="btn-primary w-full py-2.5 text-sm font-semibold disabled:opacity-50">
                      {vendorLoading ? "Submitting..." : "Submit registration"}
                    </button>
                  </form>
                ) : !emailOtpSent ? (
                  <form onSubmit={handleEmailOtpRequest} className="space-y-4">
                    <p className="rounded-lg bg-gray-50 border border-gray-100 p-3 text-xs text-gray-600">
                      For approved vendor companies only. Enter the contact email your company registered with.
                    </p>
                    <div>
                      <label className={labelCls}>Email</label>
                      <input type="email" required placeholder="you@example.com" className={inputCls} value={emailOtpAddress} onChange={(e) => setEmailOtpAddress(e.target.value)} />
                    </div>
                    {emailOtpError && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{emailOtpError}</div>}
                    <button type="submit" disabled={emailOtpLoading} className="btn-primary w-full py-2.5 text-sm font-semibold disabled:opacity-50">
                      {emailOtpLoading ? "Sending OTP..." : "Get One-Time Password"}
                    </button>
                  </form>
                ) : (
                  <form onSubmit={handleEmailOtpVerify} className="space-y-4">
                    {emailOtpMessage ? (
                      <div className="rounded-lg bg-amber-50 border border-amber-100 p-3 text-sm text-amber-800">
                        <p className="font-medium">Dev mode - OTP (delivered by email in production):</p>
                        <p className="mt-1 font-mono font-bold text-base tracking-wider">{emailOtpMessage}</p>
                      </div>
                    ) : (
                      <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-3 text-sm text-emerald-800">
                        If that email is registered and approved, a 6-digit code has been sent to it.
                      </div>
                    )}
                    <div>
                      <label className={labelCls}>Enter 6-digit OTP</label>
                      <input type="text" required maxLength={6} placeholder="123456" className={`${inputCls} font-mono tracking-widest text-center`} value={emailOtpCode} onChange={(e) => setEmailOtpCode(e.target.value)} />
                    </div>
                    {emailOtpError && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{emailOtpError}</div>}
                    <div className="flex gap-2">
                      <button type="button" onClick={() => { setEmailOtpSent(false); setEmailOtpCode(""); }} className="flex-1 rounded-xl border border-gray-300 px-3 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors">
                        Back
                      </button>
                      <button type="submit" disabled={emailOtpLoading} className="flex-[2] btn-primary py-2.5 text-sm font-semibold disabled:opacity-50">
                        {emailOtpLoading ? "Verifying..." : "Verify & Sign In"}
                      </button>
                    </div>
                  </form>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
