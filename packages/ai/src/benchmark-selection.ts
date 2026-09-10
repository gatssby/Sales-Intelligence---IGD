export function selectBenchmarkCalls<T extends { characterCount: number }>(input: {
  candidates: T[];
  phase: string;
  sampleSize: number;
}): T[] {
  const { candidates, phase, sampleSize } = input;
  if (!Number.isInteger(sampleSize) || sampleSize < 1) throw new Error("invalid_benchmark_sample_size");
  if (!candidates.length) return [];
  if (phase.includes("stress")) return [candidates.at(-1)!];

  const nonExtreme = candidates.filter((item) => item.characterCount < 150_000);
  if (!nonExtreme.length) return [];
  if (sampleSize === 1) return [nonExtreme[0]];
  if (sampleSize === 3) {
    const targets = [0, 34_000, 70_000];
    const remaining = [...nonExtreme];
    return targets.flatMap((target, index) => {
      if (!remaining.length) return [];
      const selected = index === 0
        ? remaining[0]
        : [...remaining].sort((a, b) => Math.abs(a.characterCount - target) - Math.abs(b.characterCount - target))[0];
      remaining.splice(remaining.indexOf(selected), 1);
      return [selected];
    });
  }

  return Array.from({ length: sampleSize }, (_, index) =>
    nonExtreme[Math.round(index * (nonExtreme.length - 1) / (sampleSize - 1))]);
}
