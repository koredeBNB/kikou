import type { CSSProperties } from "react";
import { Cloud } from "@/components/art/cloud";
import { cn } from "@/lib/utils";

type CloudSpec = { top: string; width: number; duration: number; delay: number; variant: 0 | 1 | 2; opacity: number };

const HERO_CLOUDS: CloudSpec[] = [
  { top: "6%", width: 260, duration: 140, delay: -20, variant: 0, opacity: 0.95 },
  { top: "15%", width: 170, duration: 110, delay: -75, variant: 2, opacity: 0.8 },
  { top: "28%", width: 320, duration: 170, delay: -120, variant: 1, opacity: 0.9 },
  { top: "9%", width: 130, duration: 95, delay: -50, variant: 1, opacity: 0.7 },
  { top: "40%", width: 210, duration: 150, delay: -10, variant: 0, opacity: 0.65 },
  { top: "22%", width: 150, duration: 125, delay: -98, variant: 2, opacity: 0.75 },
];

const CALM_CLOUDS: CloudSpec[] = [
  { top: "40px", width: 220, duration: 160, delay: -30, variant: 0, opacity: 0.9 },
  { top: "110px", width: 150, duration: 130, delay: -90, variant: 2, opacity: 0.75 },
  { top: "70px", width: 280, duration: 190, delay: -140, variant: 1, opacity: 0.8 },
];

const SEEDS = [
  { left: "8%", size: 5, duration: 16, delay: -2, x: 60 },
  { left: "17%", size: 3, duration: 19, delay: -9, x: -30 },
  { left: "29%", size: 6, duration: 14, delay: -5, x: 80 },
  { left: "41%", size: 4, duration: 21, delay: -14, x: 40 },
  { left: "53%", size: 3, duration: 17, delay: -1, x: -50 },
  { left: "62%", size: 5, duration: 15, delay: -11, x: 70 },
  { left: "71%", size: 4, duration: 20, delay: -6, x: -20 },
  { left: "83%", size: 6, duration: 18, delay: -13, x: 50 },
  { left: "92%", size: 3, duration: 16, delay: -8, x: -60 },
];

const FLOWERS = [
  [140, 292, "#FFFFFF"],
  [210, 300, "#F9CFC8"],
  [330, 288, "#FFE3A1"],
  [470, 296, "#FFFFFF"],
  [560, 284, "#DDD3F7"],
  [700, 300, "#F9CFC8"],
  [820, 290, "#FFFFFF"],
  [930, 298, "#FFE3A1"],
  [1010, 282, "#F9CFC8"],
  [1150, 296, "#FFFFFF"],
  [1250, 286, "#DDD3F7"],
  [1350, 298, "#FFE3A1"],
] as const;

function Clouds({ specs }: { specs: CloudSpec[] }) {
  return specs.map((c, i) => (
    <div
      key={i}
      className="absolute left-0 animate-drift will-change-transform"
      style={
        {
          top: c.top,
          width: c.width,
          opacity: c.opacity,
          "--drift-duration": `${c.duration}s`,
          animationDelay: `${c.delay}s`,
        } as CSSProperties
      }
    >
      <Cloud variant={c.variant} className="w-full" />
    </div>
  ));
}

function Hills() {
  return (
    <svg
      viewBox="0 0 1440 320"
      preserveAspectRatio="xMidYMax slice"
      className="absolute inset-x-0 bottom-0 h-[30vh] min-h-[190px] w-full"
      aria-hidden
    >
      <path
        d="M0 190 C180 130 360 122 540 150 C720 178 860 122 1040 110 C1200 100 1340 140 1440 160 L1440 320 L0 320 Z"
        fill="#D5EBCB"
      />
      <g transform="translate(-190 -6)">
        <path d="M334 183 L363 160 L392 183 Z" fill="#E2836B" />
        <rect x="378" y="161" width="6" height="13" rx="1.5" fill="#C86E58" />
        <rect x="340" y="181" width="46" height="30" rx="3" fill="#FFF4E0" stroke="#EBD6B4" strokeWidth="1.5" />
        <rect x="350" y="189" width="10" height="9" rx="2" fill="#FFD27A" />
        <rect x="368" y="193" width="9" height="18" rx="2" fill="#B98A64" />
        {[0, 1.3, 2.6].map((delay) => (
          <circle
            key={delay}
            cx="381"
            cy="156"
            r="4"
            fill="#FFFFFF"
            className="animate-puff"
            style={{ animationDelay: `${delay}s`, transformBox: "fill-box", transformOrigin: "center" }}
          />
        ))}
      </g>
      <path
        d="M0 232 C200 182 380 192 560 216 C760 242 900 182 1100 176 C1260 171 1360 200 1440 210 L1440 320 L0 320 Z"
        fill="#B7DC9E"
      />
      <g transform="translate(190 2)">
        <rect x="1076" y="150" width="8" height="34" rx="3" fill="#8B6A4E" />
        <circle cx="1080" cy="136" r="27" fill="#6FAF5C" />
        <circle cx="1060" cy="149" r="18" fill="#7DBA68" />
        <circle cx="1099" cy="151" r="17" fill="#64A452" />
        <circle cx="1071" cy="125" r="10" fill="#9BCF83" opacity="0.85" />
      </g>
      <path
        d="M0 272 C240 236 420 246 640 263 C860 281 1060 236 1260 241 C1350 243 1400 252 1440 258 L1440 320 L0 320 Z"
        fill="#94C87B"
      />
      <path
        d="M0 272 C240 236 420 246 640 263 C860 281 1060 236 1260 241 C1350 243 1400 252 1440 258"
        fill="none"
        stroke="#BDE2A4"
        strokeWidth="4"
        opacity="0.8"
      />
      {FLOWERS.map(([x, y, color], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="5" fill={color} />
          <circle cx={x} cy={y} r="1.8" fill="#F2A93B" />
        </g>
      ))}
      {[100, 260, 420, 610, 760, 880, 1080, 1200, 1320].map((x, i) => (
        <path
          key={x}
          d={`M${x} ${306 - (i % 3) * 4} l4 -10 M${x + 6} ${306 - (i % 3) * 4} l-1 -12 M${x + 11} ${306 - (i % 3) * 4} l-4 -9`}
          stroke="#7DB866"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

/** Watercolour sky with drifting clouds, warm sun and rolling meadow hills. */
export function SkyScene({ variant = "hero", className }: { variant?: "hero" | "calm"; className?: string }) {
  const hero = variant === "hero";
  return (
    <div aria-hidden className={cn("pointer-events-none fixed inset-0 -z-10 overflow-hidden", className)}>
      <div
        className="absolute inset-0"
        style={{
          background: hero
            ? "linear-gradient(180deg, #BCE0F5 0%, #D8EEFB 30%, #F4F4EC 62%, #FFF6E4 82%, #FFFAF0 100%)"
            : "linear-gradient(180deg, #CBE7F8 0px, #E4F3FC 160px, #FFF8EA 420px, #FFFAF0 640px)",
        }}
      />
      <div
        className="absolute -right-24 -top-28 size-[520px] animate-glow rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgb(255 244 205 / 0.95) 0%, rgb(255 226 150 / 0.55) 32%, rgb(255 226 150 / 0) 68%)",
        }}
      />
      <div className={cn("absolute inset-x-0 top-0", hero ? "h-[70vh]" : "h-[260px]")}>
        <Clouds specs={hero ? HERO_CLOUDS : CALM_CLOUDS} />
      </div>
      {hero && (
        <>
          <Hills />
          {SEEDS.map((s, i) => (
            <span
              key={i}
              className="absolute bottom-[12vh] animate-rise rounded-full bg-white shadow-[0_0_8px_2px_rgb(255_255_255/0.8)]"
              style={
                {
                  left: s.left,
                  width: s.size,
                  height: s.size,
                  "--rise-duration": `${s.duration}s`,
                  "--rise-x": `${s.x}px`,
                  animationDelay: `${s.delay}s`,
                } as CSSProperties
              }
            />
          ))}
        </>
      )}
      <div className="paper-grain absolute inset-0 opacity-[0.07]" />
    </div>
  );
}
