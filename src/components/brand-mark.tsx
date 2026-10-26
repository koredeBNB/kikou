import Link from "next/link";
import { Pip } from "@/components/art/pip";
import { BRAND_NAME } from "@/lib/brand";
import { cn } from "@/lib/utils";

export function BrandMark({ className, onClick }: { className?: string; onClick?: () => void }) {
  return (
    <Link href="/" onClick={onClick} className={cn("group inline-flex items-center gap-2", className)} aria-label={`${BRAND_NAME} home`}>
      <span className="relative inline-flex size-10 items-center justify-center rounded-full bg-white/80 shadow-[0_4px_14px_-6px_rgb(73_88_120/0.45)] transition-transform group-hover:-rotate-6">
        <Pip still className="size-8" title="" />
      </span>
      <span className="font-heading text-xl font-semibold tracking-tight text-ink">
        {/* Split along the kanji, 記 (ki) and 憶 (oku). */}
        Ki<span className="text-meadow-600">oku</span>
      </span>
    </Link>
  );
}
