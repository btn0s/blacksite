export function stepConsoleOption<T extends { value: string }>(
  options: readonly T[],
  value: string,
  step: number
): string {
  if (options.length === 0) return value
  const index = options.findIndex((option) => option.value === value)
  const next = ((index + step) % options.length + options.length) % options.length
  return options[next]!.value
}

export function stepConsoleNumber(
  value: number,
  direction: number,
  min: number,
  max: number,
  step: number
): number {
  return Number(Math.max(min, Math.min(max, value + direction * step)).toFixed(3))
}
