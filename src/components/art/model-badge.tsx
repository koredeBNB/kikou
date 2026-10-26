import { cn } from "@/lib/utils";
import { MODEL_LABELS, type ModelId } from "@/lib/sov/types";

export const MODEL_COLORS: Record<ModelId, { bg: string; ink: string; solid: string }> = {
  chatgpt: { bg: "#D6F1E5", ink: "#2C8263", solid: "#5DB590" },
  claude: { bg: "#FCE3D3", ink: "#B85B34", solid: "#E58C5F" },
  gemini: { bg: "#E3E4FB", ink: "#5B5FC7", solid: "#8B8FE6" },
  perplexity: { bg: "#D3EDF0", ink: "#257A86", solid: "#4FA7B3" },
};

function Glyph({ model, color }: { model: ModelId; color: string }) {
  switch (model) {
    case "chatgpt":
      return (
        <g fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round">
          {[0, 60, 120].map((deg) => (
            <ellipse key={deg} cx="16" cy="16" rx="8.5" ry="4" transform={`rotate(${deg} 16 16)`} />
          ))}
        </g>
      );
    case "claude":
      return (
        <g stroke={color} strokeWidth="2.4" strokeLinecap="round">
          {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
            <line key={deg} x1="16" y1="9" x2="16" y2="5" transform={`rotate(${deg} 16 16)`} />
          ))}
          <circle cx="16" cy="16" r="4.2" fill={color} stroke="none" />
        </g>
      );
    case "gemini":
      return (
        <path
          d="M16 5 C17 11 21 15 27 16 C21 17 17 21 16 27 C15 21 11 17 5 16 C11 15 15 11 16 5 Z"
          fill={color}
        />
      );
    case "perplexity":
      return (
        <g stroke={color} strokeWidth="2.3" strokeLinecap="round" fill="none">
          <line x1="16" y1="6" x2="16" y2="26" />
          <line x1="7.5" y1="11" x2="24.5" y2="21" />
          <line x1="24.5" y1="11" x2="7.5" y2="21" />
          <circle cx="16" cy="16" r="3" fill="#fff" />
        </g>
      );
  }
}

/** Soft, original glyph badges for each assistant (not official logos). */
export function ModelBadge({ model, className, title }: { model: ModelId; className?: string; title?: string }) {
  const c = MODEL_COLORS[model];
  return (
    <span
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-full shadow-[inset_0_1px_0_rgb(255_255_255/0.8),0_2px_6px_-2px_rgb(60_70_100/0.25)]",
        className,
      )}
      style={{ backgroundColor: c.bg }}
      title={title ?? MODEL_LABELS[model]}
    >
      <svg viewBox="0 0 32 32" className="size-[70%]" aria-hidden>
        <Glyph model={model} color={c.ink} />
      </svg>
    </span>
  );
}
