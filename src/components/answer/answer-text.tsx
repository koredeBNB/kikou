import { Fragment, type ReactNode } from "react";
import { stripTracking } from "@/lib/sov/citations";
import { cn } from "@/lib/utils";

const INLINE = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)]+)|(\[\d+\])/g;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlight(text: string, product: string, rivals: string[], keyBase: string): ReactNode[] {
  const names = [product, ...rivals].filter(Boolean).sort((a, b) => b.length - a.length);
  if (names.length === 0) return [text];
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(${names.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}])`, "giu");
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) out.push(text.slice(last, index));
    const isProduct = match[0].toLowerCase() === product.toLowerCase();
    out.push(
      <mark
        key={`${keyBase}-${index}`}
        className={cn(
          "rounded-md px-1 py-px font-semibold text-inherit",
          isProduct ? "bg-meadow-200/80 text-meadow-700" : "bg-sky-100",
        )}
      >
        {match[0]}
      </mark>,
    );
    last = index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function inline(text: string, product: string, rivals: string[], key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) out.push(...highlight(text.slice(last, index), product, rivals, `${key}-t${i}`));
    if (match[1]) {
      out.push(<strong key={`${key}-b${i}`}>{highlight(match[1], product, rivals, `${key}-bb${i}`)}</strong>);
    } else if (match[2] && match[3]) {
      out.push(
        <a key={`${key}-l${i}`} href={stripTracking(match[3])} target="_blank" rel="noreferrer" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2">
          {match[2]}
        </a>,
      );
    } else if (match[4]) {
      const url = stripTracking(match[4]);
      out.push(
        <a key={`${key}-u${i}`} href={url} target="_blank" rel="noreferrer" className="break-all text-sky-700 underline decoration-sky-300 underline-offset-2">
          {url}
        </a>,
      );
    } else if (match[5]) {
      out.push(
        <sup key={`${key}-c${i}`} className="ml-0.5 rounded bg-lavender-100 px-1 text-[0.65rem] font-bold text-lavender-500">
          {match[5].slice(1, -1)}
        </sup>,
      );
    }
    last = index + match[0].length;
    i++;
  }
  if (last < text.length) out.push(...highlight(text.slice(last), product, rivals, `${key}-end`));
  return out;
}

/** Renders the light markdown that assistants return, highlighting tracked brands. */
export function AnswerText({ text, product, rivals = [] }: { text: string; product: string; rivals?: string[] }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: ReactNode[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={`list-${blocks.length}`} className={cn("my-2 space-y-1.5 pl-5", list.ordered ? "list-decimal" : "list-disc", "marker:text-meadow-500")}>
        {list.items}
      </Tag>,
    );
    list = null;
  };

  text.split("\n").forEach((raw, lineIndex) => {
    const line = raw.trimEnd();
    const key = `line-${lineIndex}`;
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const bullet = line.match(/^\s*[-*•+]\s+(.*)$/);
    const heading = line.match(/^\s*#{1,6}\s+(.*)$/);
    if (ordered || bullet) {
      const isOrdered = Boolean(ordered);
      if (list && list.ordered !== isOrdered) flush();
      list ??= { ordered: isOrdered, items: [] };
      list.items.push(<li key={key}>{inline((ordered ?? bullet)![1], product, rivals, key)}</li>);
      return;
    }
    flush();
    if (!line.trim()) return;
    if (heading) {
      blocks.push(
        <p key={key} className="mt-2 font-heading text-base font-semibold">
          {inline(heading[1], product, rivals, key)}
        </p>,
      );
      return;
    }
    blocks.push(
      <p key={key} className="my-1.5">
        {inline(line, product, rivals, key)}
      </p>,
    );
  });
  flush();

  return <div className="text-[0.95rem] leading-relaxed text-ink">{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</div>;
}
