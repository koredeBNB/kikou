"use client";

import { ArrowUp02Icon } from "@hugeicons/core-free-icons";
import { motion } from "motion/react";
import { useEffect, useRef, type FormEvent, type KeyboardEvent } from "react";
import { ModelBadge } from "@/components/art/model-badge";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ProviderStatus } from "@/lib/providers/config";
import { cn } from "@/lib/utils";

export function ProviderStack({ providers }: { providers: ProviderStatus[] }) {
  const live = providers.filter((p) => p.source === "live").length;
  const label =
    providers.length === 0
      ? "Checking assistants…"
      : live === 0
        ? "4 assistants · demo answers"
        : live === providers.length
          ? `${live} assistants · live`
          : `${live} live · ${providers.length - live} demo`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="flex items-center gap-2 rounded-full py-1 pr-3 pl-1 text-sm font-semibold text-ink-soft transition hover:bg-sky-50">
          <span className="flex -space-x-2">
            {(providers.length ? providers.map((p) => p.id) : (["chatgpt", "claude", "gemini", "perplexity"] as const)).map((id) => (
              <ModelBadge key={id} model={id} className="size-7 ring-2 ring-white" />
            ))}
          </span>
          <span className="hidden sm:inline">{label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64">
        {providers.map((p) => (
          <div key={p.id} className="flex justify-between gap-4">
            <span>{p.label}</span>
            <span className="opacity-75">{p.source === "live" ? p.modelName : "demo answers"}</span>
          </div>
        ))}
        {live < providers.length && <p className="mt-1 opacity-75">Add API keys to switch assistants to live answers.</p>}
      </TooltipContent>
    </Tooltip>
  );
}

export function Composer({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled,
  hero = false,
  providers,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder: string;
  disabled?: boolean;
  hero?: boolean;
  providers: ProviderStatus[];
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus && !disabled) ref.current?.focus({ preventScroll: true });
  }, [autoFocus, disabled, placeholder]);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (disabled || !value.trim()) return;
    onSubmit(value.trim());
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) submit(event);
  };

  return (
    <motion.form
      layoutId="composer"
      transition={{ type: "spring", stiffness: 260, damping: 30 }}
      onSubmit={submit}
      className={cn(
        "pillow relative w-full rounded-[2rem] p-2 transition-shadow focus-within:shadow-pillow-lg focus-within:ring-4 focus-within:ring-sky-200/70",
        hero && "rounded-[2.25rem] p-2.5",
      )}
    >
      <Textarea
        ref={ref}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label="Message Pip"
        rows={hero ? 2 : 1}
        className={cn(
          "max-h-44 border-0 bg-transparent px-4 text-ink shadow-none placeholder:text-ink-soft/70 focus-visible:ring-0 md:text-base",
          hero ? "min-h-20 pt-3 text-lg md:text-lg" : "min-h-12 pt-2.5",
        )}
      />
      <div className="flex items-center justify-between gap-2 pl-1">
        <ProviderStack providers={providers} />
        <Button
          type="submit"
          size="icon-lg"
          disabled={disabled || !value.trim()}
          aria-label="Send"
          className="rounded-full disabled:opacity-40"
        >
          <Icon icon={ArrowUp02Icon} className="size-5" strokeWidth={2.4} />
        </Button>
      </div>
    </motion.form>
  );
}
