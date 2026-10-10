"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

type Tone = "info" | "success" | "error";

interface Toast {
  id: number;
  message: string;
  tone: Tone;
}

interface ToastState {
  toast(message: string, tone?: Tone): void;
}

const ToastContext = createContext<ToastState | undefined>(undefined);

const TONE: Record<Tone, string> = {
  info: "border-brand-200 bg-white text-slate-900",
  success: "border-green-200 bg-white text-slate-900",
  error: "border-red-200 bg-white text-slate-900",
};
const DOT: Record<Tone, string> = {
  info: "bg-brand-500",
  success: "bg-status-good",
  error: "bg-status-critical",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const toast = useCallback((message: string, tone: Tone = "info") => {
    const id = nextId.current++;
    setToasts((t) => [...t.slice(-2), { id, message, tone }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 left-4 z-50 flex flex-col items-end gap-2 sm:left-auto" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`animate-toast-in pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg ${TONE[t.tone]}`}
          >
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[t.tone]}`} aria-hidden />
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastState {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
