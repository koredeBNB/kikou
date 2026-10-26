/**
 * Which items a collapsed list shows: up to `limit`, shared round-robin across topic groups
 * so every topic is represented, returned as indexes in the original order.
 */
export function previewIndexes(items: readonly { topic?: string }[], limit: number): number[] {
  if (items.length <= limit) return items.map((_, i) => i);
  const groups = new Map<string | undefined, number[]>();
  items.forEach((item, i) => {
    const group = groups.get(item.topic);
    if (group) group.push(i);
    else groups.set(item.topic, [i]);
  });
  const lists = [...groups.values()];
  const picked: number[] = [];
  for (let round = 0; picked.length < limit; round++) {
    for (const list of lists) {
      if (round < list.length && picked.length < limit) picked.push(list[round]);
    }
  }
  return picked.sort((a, b) => a - b);
}
