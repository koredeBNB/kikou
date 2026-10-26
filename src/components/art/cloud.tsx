import { useId } from "react";
import { cn } from "@/lib/utils";

const SHAPES = [
  {
    circles: [
      [52, 64, 26],
      [84, 46, 32],
      [122, 50, 29],
      [152, 65, 21],
    ],
    base: [28, 60, 146, 28],
  },
  {
    circles: [
      [46, 62, 20],
      [72, 48, 25],
      [104, 40, 30],
      [138, 52, 24],
      [162, 66, 16],
    ],
    base: [28, 60, 146, 24],
  },
  {
    circles: [
      [60, 58, 24],
      [96, 44, 30],
      [132, 58, 22],
    ],
    base: [38, 58, 112, 24],
  },
] as const;

/** A puffy watercolour cloud. Original artwork. */
export function Cloud({ variant = 0, className }: { variant?: 0 | 1 | 2; className?: string }) {
  const id = useId().replace(/:/g, "");
  const shape = SHAPES[variant];
  const [bx, by, bw, bh] = shape.base;
  const body = (
    <>
      {shape.circles.map(([cx, cy, r], i) => (
        <circle key={i} cx={cx} cy={cy} r={r} />
      ))}
      <rect x={bx} y={by} width={bw} height={bh} rx={bh / 2} />
    </>
  );

  return (
    <svg viewBox="0 0 200 100" aria-hidden className={cn("overflow-visible", className)}>
      <defs>
        <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="70%" stopColor="#FDFDFF" />
          <stop offset="100%" stopColor="#EAF3FB" />
        </linearGradient>
        <filter id={`${id}-soft`} x="-20%" y="-20%" width="140%" height="160%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>
      <g fill="#C9DDF0" opacity="0.55" transform="translate(4 7)" filter={`url(#${id}-soft)`}>
        {body}
      </g>
      <g fill={`url(#${id}-fill)`}>{body}</g>
      <g fill="#FFFFFF" opacity="0.9">
        {shape.circles.slice(0, 2).map(([cx, cy, r], i) => (
          <circle key={i} cx={cx - r * 0.25} cy={cy - r * 0.3} r={r * 0.45} />
        ))}
      </g>
    </svg>
  );
}
