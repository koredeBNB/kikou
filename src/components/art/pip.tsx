import { useId } from "react";
import { cn } from "@/lib/utils";

export type PipMood = "idle" | "thinking" | "happy" | "wave";

const fillBox = { transformBox: "fill-box", transformOrigin: "center" } as const;

/** Pip, the meadowlark fledgling who runs the checks. Original artwork. */
export function Pip({
  mood = "idle",
  className,
  still = false,
  title = "Pip, Kioku's guide",
}: {
  mood?: PipMood;
  className?: string;
  still?: boolean;
  title?: string;
}) {
  const id = useId().replace(/:/g, "");
  const happy = mood === "happy" || mood === "wave";
  const look = mood === "thinking" ? { x: 1.4, y: -1.8 } : { x: 0, y: 0 };

  return (
    <svg viewBox="0 0 120 120" role="img" aria-label={title} className={cn("overflow-visible", className)}>
      <defs>
        <radialGradient id={`${id}-body`} cx="38%" cy="32%" r="75%">
          <stop offset="0%" stopColor="#FFF4CF" />
          <stop offset="55%" stopColor="#FFDA8F" />
          <stop offset="100%" stopColor="#F2B955" />
        </radialGradient>
        <radialGradient id={`${id}-belly`} cx="50%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#FFFEF8" />
          <stop offset="100%" stopColor="#FFEFCF" />
        </radialGradient>
        <linearGradient id={`${id}-leaf`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#B4DD95" />
          <stop offset="100%" stopColor="#6CAF5C" />
        </linearGradient>
      </defs>

      <g className={cn(!still && "animate-bob")}>
        <path d="M26 76 Q9 73 5 59 Q17 62 29 65 Z" fill="#EDB458" />
        <path d="M24 72 Q14 69 11 62" stroke="#F6CB7A" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <path d="M52 99 v7 M68 99 v7 M49 106 h6 M65 106 h6" stroke="#E58A3E" strokeWidth="2.8" strokeLinecap="round" />

        <ellipse cx="60" cy="64" rx="38" ry="37" fill={`url(#${id}-body)`} />
        <ellipse cx="62" cy="79" rx="24" ry="18.5" fill={`url(#${id}-belly)`} />
        <path d="M46 92 q3 2 6 0 M58 95 q3 2 6 0 M70 92 q3 2 6 0" stroke="#F3DDB2" strokeWidth="1.4" fill="none" strokeLinecap="round" />

        <g
          className={cn(mood === "wave" && !still && "animate-wiggle")}
          style={{ transformBox: "fill-box", transformOrigin: "10% 20%" }}
        >
          <path d="M84 58 Q101 61 99 81 Q88 86 80 74 Z" fill="#F0BC5E" stroke="#E4A447" strokeWidth="1.4" />
          <path d="M86 64 Q94 67 94 76" stroke="#F8D48E" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        </g>

        <g className={cn(!still && "animate-sway")} style={{ transformBox: "fill-box", transformOrigin: "50% 100%" }}>
          <path d="M60 29 C60 23 60 18 61.5 13" stroke="#5E9F50" strokeWidth="2.6" fill="none" strokeLinecap="round" />
          <path d="M61.5 15.5 C66 7 76 7 79 10.5 C75 17 67 19 61.5 15.5 Z" fill={`url(#${id}-leaf)`} />
          <path d="M60.5 19.5 C55 12 46 12 43 15.5 C47 21 55 22 60.5 19.5 Z" fill="#A6D48B" />
        </g>

        {happy ? (
          <g stroke="#2F2B3F" strokeWidth="2.8" fill="none" strokeLinecap="round">
            <path d="M42.5 57.5 Q47 51 51.5 57.5" />
            <path d="M68.5 57.5 Q73 51 77.5 57.5" />
          </g>
        ) : (
          <g className={cn(!still && "animate-blink")} style={fillBox}>
            <ellipse cx={47 + look.x} cy={56 + look.y} rx="4.4" ry="5.3" fill="#2F2B3F" />
            <ellipse cx={73 + look.x} cy={56 + look.y} rx="4.4" ry="5.3" fill="#2F2B3F" />
            <circle cx={48.7 + look.x} cy={53.8 + look.y} r="1.6" fill="#fff" />
            <circle cx={74.7 + look.x} cy={53.8 + look.y} r="1.6" fill="#fff" />
          </g>
        )}

        <ellipse cx="37.5" cy="66.5" rx="6.2" ry="3.7" fill="#F49C94" opacity="0.55" />
        <ellipse cx="82.5" cy="66.5" rx="6.2" ry="3.7" fill="#F49C94" opacity="0.55" />
        <path d="M54.5 63 Q60 60.5 65.5 63 Q61.5 70.5 60 70.5 Q58.5 70.5 54.5 63 Z" fill="#F08F45" />
        <path d="M56.5 63.2 Q60 62 63.5 63.2" stroke="#F8B57A" strokeWidth="1.1" fill="none" strokeLinecap="round" />

        {mood === "thinking" && (
          <g fill="#FFFFFF" stroke="#C3E3F6" strokeWidth="1.2">
            <circle cx="96" cy="34" r="3" className={cn(!still && "animate-hop")} />
            <circle cx="104" cy="24" r="4.2" className={cn(!still && "animate-hop")} style={{ animationDelay: "0.15s" }} />
            <circle cx="113" cy="12" r="5.6" className={cn(!still && "animate-hop")} style={{ animationDelay: "0.3s" }} />
          </g>
        )}
      </g>
    </svg>
  );
}
