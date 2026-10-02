import type { ComponentProps, ReactNode } from "react";
import Link from "next/link";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: "primary" | "secondary" | "danger" }) {
  const styles = {
    primary: "bg-brand-600 text-white hover:bg-brand-700",
    secondary: "bg-white text-ink border border-line hover:bg-slate-50",
    danger: "bg-white text-critical border border-red-200 hover:bg-red-50",
  }[variant];

  return (
    <button
      {...props}
      className={`inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    />
  );
}

export function LinkButton({ className = "", ...props }: ComponentProps<typeof Link>) {
  return (
    <Link
      {...props}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-700 ${className}`}
    />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-ink-muted">{hint}</span>}
    </label>
  );
}

export function Input({ className = "", ...props }: ComponentProps<"input">) {
  return (
    <input
      {...props}
      className={`block min-h-11 w-full rounded-lg border border-line bg-white px-3 text-base text-ink placeholder:text-slate-400 focus:border-brand-600 focus:outline-none ${className}`}
    />
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-white p-5 sm:p-6 ${className}`}>
      {children}
    </section>
  );
}

export function Notice({ tone = "error", children }: { tone?: "error" | "success" | "info"; children: ReactNode }) {
  const styles = {
    error: "border-red-200 bg-red-50 text-red-800",
    success: "border-green-200 bg-green-50 text-green-800",
    info: "border-brand-100 bg-brand-50 text-brand-700",
  }[tone];
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`rounded-lg border px-3 py-2.5 text-sm ${styles}`}>
      {children}
    </p>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div aria-hidden="true" className="mb-4 flex size-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
        {icon}
      </div>
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {children && <p className="mt-1.5 max-w-sm text-sm text-ink-muted">{children}</p>}
    </div>
  );
}

/** Small coloured score pill used across the dashboard. */
export function ScorePill({ score }: { score: number | null }) {
  if (score === null) {
    return <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-ink-muted">Not checked</span>;
  }
  const tone =
    score >= 80 ? "bg-green-100 text-green-800" : score >= 55 ? "bg-amber-100 text-amber-900" : "bg-red-100 text-red-800";
  return <span className={`rounded-full px-2.5 py-1 text-xs font-bold tabular-nums ${tone}`}>{score}/100</span>;
}
