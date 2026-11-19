const SANITIZE_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{8,}/g,
  /bearer\s+\S+/gi,
  /gh[pousr]_[A-Za-z0-9]{16,}/g,
  /xox[baprs]-\S+/g,
];

export function sanitizeText(value: string): string {
  let result = value;
  for (const pattern of SANITIZE_PATTERNS) {
    result = result.replace(pattern, "***");
  }
  return result;
}
