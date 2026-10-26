"use client";

import type { IconSvgElement } from "@hugeicons/react";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { Icon } from "@/components/icon";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Report } from "@/lib/sov/types";
import { cn } from "@/lib/utils";

export const PRODUCT_COLOR = "#6CAF5C";
export const OTHERS_COLOR = "#E6DCC8";
const RIVAL_COLORS = ["#8CC5EC", "#FFC56E", "#F2A79C", "#B4A3EC", "#79C9BE", "#F0B0D4", "#C3D27E", "#A9B8D8"];

export function brandColors(report: Report): Map<string, string> {
  const colors = new Map<string, string>();
  let i = 0;
  for (const b of report.brands) colors.set(b.brand, b.isProduct ? PRODUCT_COLOR : RIVAL_COLORS[i++ % RIVAL_COLORS.length]);
  return colors;
}

export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18, scale: 0.985 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, margin: "0px 0px -60px 0px" }}
      transition={{ type: "spring", stiffness: 210, damping: 24, delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function SectionCard({
  id,
  icon,
  tint = "bg-sky-100 text-sky-700",
  title,
  description,
  action,
  children,
  className,
  contentClassName,
}: {
  id?: string;
  icon: IconSvgElement;
  tint?: string;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card id={id} className={cn("h-full scroll-mt-24 gap-5", className)}>
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-2xl", tint)}>
            <Icon icon={icon} className="size-5" />
          </span>
          <div className="min-w-0">
            <CardTitle className="text-lg font-semibold">{title}</CardTitle>
            {description && <CardDescription className="mt-0.5">{description}</CardDescription>}
          </div>
        </div>
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className={cn("flex-1", contentClassName)}>{children}</CardContent>
    </Card>
  );
}

export function Meter({ value, color, className }: { value: number; color: string; className?: string }) {
  return (
    <span className={cn("block h-2.5 flex-1 overflow-hidden rounded-full bg-[#F1E7D4]", className)}>
      <motion.span
        className="block h-full rounded-full"
        style={{ backgroundColor: color }}
        initial={{ width: 0 }}
        whileInView={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
        viewport={{ once: true }}
        transition={{ duration: 0.8, ease: "easeOut" }}
      />
    </span>
  );
}

export function Dot({ color, className }: { color: string; className?: string }) {
  return <span className={cn("inline-block size-2.5 shrink-0 rounded-full", className)} style={{ backgroundColor: color }} />;
}
