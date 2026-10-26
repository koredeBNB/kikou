"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";
import { Pip, type PipMood } from "@/components/art/pip";
import { cn } from "@/lib/utils";

const pop = {
  initial: { opacity: 0, y: 14, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1 },
  transition: { type: "spring", stiffness: 380, damping: 28 },
} as const;

export function PipMessage({
  children,
  mood = "idle",
  wide = false,
  className,
}: {
  children: ReactNode;
  mood?: PipMood;
  wide?: boolean;
  className?: string;
}) {
  return (
    <motion.div {...pop} className="flex items-end gap-2.5 sm:gap-3">
      <div className="relative mb-1 hidden size-11 shrink-0 items-center justify-center rounded-full bg-white shadow-[0_6px_16px_-8px_rgb(73_88_120/0.5)] sm:flex">
        <Pip mood={mood} still className="size-9" title="Pip" />
      </div>
      <div
        className={cn(
          "pillow relative min-w-0 rounded-[1.6rem] rounded-bl-md px-5 py-3.5 text-[0.98rem] leading-relaxed text-ink",
          wide ? "w-full" : "max-w-[min(36rem,100%)]",
          className,
        )}
      >
        {children}
      </div>
    </motion.div>
  );
}

export function UserMessage({ children }: { children: ReactNode }) {
  return (
    <motion.div {...pop} className="flex justify-end">
      <div className="max-w-[min(32rem,85%)] rounded-[1.6rem] rounded-br-md bg-gradient-to-b from-meadow-100 to-meadow-200 px-5 py-3 text-[0.98rem] leading-relaxed text-[#2c4a2b] shadow-[inset_0_1px_0_rgb(255_255_255/0.7),0_8px_20px_-12px_rgb(59_127_63/0.6)]">
        {children}
      </div>
    </motion.div>
  );
}

export function TypingMessage() {
  return (
    <motion.div {...pop} data-typing className="flex items-end gap-3" aria-live="polite" aria-label="Pip is typing">
      <div className="relative mb-1 hidden size-11 shrink-0 items-center justify-center rounded-full bg-white shadow-[0_6px_16px_-8px_rgb(73_88_120/0.5)] sm:flex">
        <Pip mood="thinking" still className="size-9" title="Pip" />
      </div>
      <div className="pillow flex gap-1.5 rounded-[1.6rem] rounded-bl-md px-5 py-4">
        {[0, 0.15, 0.3].map((delay) => (
          <span key={delay} className="size-2 animate-hop rounded-full bg-meadow-500" style={{ animationDelay: `${delay}s` }} />
        ))}
      </div>
    </motion.div>
  );
}

export function QuickReplies({
  options,
  onPick,
  disabled,
}: {
  options: string[];
  onPick: (value: string) => void;
  disabled?: boolean;
}) {
  if (options.length === 0) return null;
  return (
    <motion.div {...pop} className="flex flex-wrap justify-end gap-2">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          disabled={disabled}
          onClick={() => onPick(option)}
          className="rounded-full border border-meadow-200 bg-white/85 px-3.5 py-1.5 text-sm font-semibold text-meadow-700 shadow-[0_4px_12px_-8px_rgb(59_127_63/0.7)] transition hover:-translate-y-0.5 hover:bg-meadow-50 active:scale-95 disabled:opacity-50"
        >
          {option}
        </button>
      ))}
    </motion.div>
  );
}
