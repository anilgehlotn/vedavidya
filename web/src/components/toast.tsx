// Toast notifications: short messages in the corner that go away by themselves.
// useToast() gives toast.success / toast.error / toast.info. Errors stay longer; every toast can be closed.
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "./icons";

type Tone = "success" | "error" | "info";
interface Toast { id: number; tone: Tone; text: string }
interface ToastApi { success: (text: string) => void; error: (text: string) => void; info: (text: string) => void }
const Ctx = createContext<ToastApi | null>(null);
const ICON = { success: "check", error: "alert", info: "info" } as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const next = useRef(1);
  const close = useCallback((id: number) => setList((l) => l.filter((t) => t.id !== id)), []);
  const push = useCallback((tone: Tone, text: string) => {
    const id = next.current++;
    setList((l) => [...l.filter((t) => t.text !== text), { id, tone, text }].slice(-4)); // no repeats, at most 4 on screen
    setTimeout(() => close(id), tone === "error" ? 7000 : 4000);
  }, [close]);
  const api = useMemo<ToastApi>(() => ({ success: (t) => push("success", t), error: (t) => push("error", t), info: (t) => push("info", t) }), [push]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts" role="region" aria-label="Notifications">
        {list.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`} role={t.tone === "error" ? "alert" : "status"}>
            <span className="toast-ic"><Icon name={ICON[t.tone]} size={16} /></span>
            <span className="grow">{t.text}</span>
            <button type="button" className="toast-x" onClick={() => close(t.id)} aria-label="Close notification"><Icon name="close" size={14} /></button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

const silent: ToastApi = { success: () => {}, error: () => {}, info: () => {} };
export const useToast = () => useContext(Ctx) ?? silent;

/**
 * Runs an action and reports the result as a toast: `ok` on success (text, or made from the result),
 * the error message on failure. Returns the result, or undefined if it failed.
 */
export function useRun() {
  const t = useToast();
  return useCallback(async <T,>(fn: () => Promise<T>, ok?: string | ((r: T) => string)): Promise<T | undefined> => {
    try {
      const r = await fn();
      if (ok) t.success(typeof ok === "function" ? ok(r) : ok);
      return r;
    } catch (e) { t.error((e as Error).message); return undefined; }
  }, [t]);
}
