export interface Chunk {
  index: number;
  content: string;
  page: number;
  startChar: number;
  tokenCount: number;
  headerBreadcrumb: string;
}

export interface ChunkConfig {
  chunkSize: number;
  chunkOverlap: number;
  minTokens: number;
}

interface HeaderItem {
  level: number;
  text: string;
}

export function defaultChunkConfig(): ChunkConfig {
  return { chunkSize: 512, chunkOverlap: 128, minTokens: 32 };
}

export function estimateTokens(text: string): number {
  const count = [...text].length;
  return Math.max(1, Math.floor(count / 4));
}

export function chunkText(text: string, page: number, config: ChunkConfig): Chunk[] {
  if (text === "") return [];

  const paragraphs = splitParagraphs(text);
  let headerStack: HeaderItem[] = [];
  const headerRegex = /^(#{1,6})\s+(.+)$/;

  const chunks: Chunk[] = [];
  let chunkIndex = 0;
  let currentTokens = 0;
  let currentChunk = "";
  const currentStartChar = 0;
  let currentBreadcrumb = "";
  let overlapBuffer = "";

  const emit = (content: string, tokens: number) => {
    chunks.push({
      index: chunkIndex,
      content,
      page,
      startChar: currentStartChar,
      tokenCount: tokens,
      headerBreadcrumb: currentBreadcrumb,
    });
    chunkIndex += 1;
  };

  for (const paragraph of paragraphs) {
    const headerMatch = headerRegex.exec(paragraph);
    if (headerMatch) {
      const level = headerMatch[1]?.length ?? 0;
      const heading = (headerMatch[2] ?? "").trim();
      const newStack: HeaderItem[] = headerStack.filter((item) => item.level < level);
      newStack.push({ level, text: heading });
      headerStack = newStack;
      currentBreadcrumb = headerStack.map((item) => item.text).join(" > ");
    }

    const paraTokens = estimateTokens(paragraph);

    if (paraTokens > config.chunkSize) {
      const sentences = splitSentences(paragraph);
      for (const sentence of sentences) {
        const sentenceTokens = estimateTokens(sentence);
        if (currentTokens + sentenceTokens > config.chunkSize && currentChunk.length > 0) {
          emit(currentChunk, currentTokens);
          currentChunk = "";
          currentTokens = 0;
          if (overlapBuffer) {
            currentChunk += overlapBuffer + " ";
            currentTokens = estimateTokens(overlapBuffer);
          }
        }
        currentChunk += sentence + " ";
        currentTokens += sentenceTokens;
        overlapBuffer = sentence;
      }
      continue;
    }

    if (currentTokens + paraTokens > config.chunkSize && currentChunk.length > 0) {
      if (estimateTokens(currentChunk) >= config.minTokens) {
        emit(currentChunk, currentTokens);
      }
      currentChunk = "";
      currentTokens = 0;
    }

    currentChunk += paragraph + "\n\n";
    currentTokens += paraTokens;
  }

  if (currentChunk.length > 0) {
    const content = currentChunk.trim();
    if (estimateTokens(content) >= config.minTokens) {
      emit(content, currentTokens);
    }
  }

  return chunks;
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

export function splitSentences(text: string): string[] {
  const parts = text.split(/[。！？.!?\n]\s*/);
  const matches = [...text.matchAll(/[。！？.!?\n]/g)].map((match) => match[0]);
  const result: string[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    let part = (parts[i] ?? "").trim();
    if (!part) continue;
    const delimiter = matches[i];
    if (delimiter) part += delimiter;
    const runes = [...part];
    if (runes.length > 10000) {
      for (let j = 0; j < runes.length; j += 5000) {
        result.push(runes.slice(j, j + 5000).join(""));
      }
    } else {
      result.push(part);
    }
  }
  return result;
}

export function isCJK(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x3040 && code <= 0x309f) ||
    (code >= 0x30a0 && code <= 0x30ff)
  );
}
