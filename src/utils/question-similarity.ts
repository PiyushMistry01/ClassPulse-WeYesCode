/**
 * Question Similarity & Deduplication Utility
 * Handles text normalization and similarity comparison
 */

/**
 * Normalize question text by:
 * - Converting to lowercase
 * - Removing punctuation and extra whitespace
 * - Trimming
 */
export function normalizeQuestionText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?;:()[\]{}""''`]/g, '') // Remove punctuation
    .replace(/\s+/g, ' ')                   // Normalize spaces
    .trim();
}

/**
 * Calculate Levenshtein distance (edit distance) between two strings
 * Returns a number representing how different two strings are
 */
function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      const cost = str1[j - 1] === str2[i - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i][j - 1]! + 1,      // Insertion
        matrix[i - 1][j]! + 1,      // Deletion
        matrix[i - 1][j - 1]! + cost // Substitution
      );
    }
  }

  return matrix[str2.length]![str1.length]!;
}

/**
 * Calculate similarity score between two strings (0 to 1)
 * 0 = completely different, 1 = exact match
 * Uses normalized text for comparison
 */
export function calculateSimilarity(text1: string, text2: string): number {
  const norm1 = normalizeQuestionText(text1);
  const norm2 = normalizeQuestionText(text2);

  // Exact match after normalization
  if (norm1 === norm2) {
    return 1.0;
  }

  // If either is empty
  if (norm1.length === 0 || norm2.length === 0) {
    return 0;
  }

  const maxLength = Math.max(norm1.length, norm2.length);
  const distance = levenshteinDistance(norm1, norm2);
  const similarity = 1 - distance / maxLength;

  return Math.max(0, Math.min(1, similarity));
}

/**
 * Extract keywords from question (split by spaces, filter short words)
 */
function extractKeywords(text: string): Set<string> {
  const normalized = normalizeQuestionText(text);
  const words = normalized.split(/\s+/).filter(word => word.length > 2);
  return new Set(words);
}

/**
 * Calculate keyword overlap similarity (0 to 1)
 * Useful for detecting concept similarity
 */
export function calculateKeywordOverlap(text1: string, text2: string): number {
  const keywords1 = extractKeywords(text1);
  const keywords2 = extractKeywords(text2);

  if (keywords1.size === 0 || keywords2.size === 0) {
    return 0;
  }

  const intersection = new Set([...keywords1].filter(k => keywords2.has(k)));
  const union = new Set([...keywords1, ...keywords2]);

  return intersection.size / union.size; // Jaccard similarity
}

/**
 * Determine if two questions should be treated as the same
 * Uses a combination of text similarity and keyword overlap
 */
export function areSimilarQuestions(
  text1: string,
  text2: string,
  options: {
    textSimilarityThreshold?: number;      // Default: 0.75
    keywordOverlapThreshold?: number;      // Default: 0.5
    requireBothThresholds?: boolean;       // Default: false (OR logic)
  } = {}
): boolean {
  const {
    textSimilarityThreshold = 0.75,
    keywordOverlapThreshold = 0.5,
    requireBothThresholds = false,
  } = options;

  const textSim = calculateSimilarity(text1, text2);
  const keywordSim = calculateKeywordOverlap(text1, text2);

  if (requireBothThresholds) {
    // Both must exceed thresholds
    return textSim >= textSimilarityThreshold && keywordSim >= keywordOverlapThreshold;
  } else {
    // Either can exceed threshold (OR logic)
    return textSim >= textSimilarityThreshold || keywordSim >= keywordOverlapThreshold;
  }
}

/**
 * Find the best matching question from a list
 * Returns the matching question and similarity score
 */
export function findMostSimilarQuestion(
  newQuestion: string,
  existingQuestions: Array<{ id: string; text: string }>,
  threshold: number = 0.75
): { match: (typeof existingQuestions)[0] | null; similarity: number } {
  let bestMatch = null;
  let bestSimilarity = 0;

  for (const existing of existingQuestions) {
    const similarity = calculateSimilarity(newQuestion, existing.text);
    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestMatch = existing;
    }
  }

  if (bestSimilarity >= threshold) {
    return { match: bestMatch, similarity: bestSimilarity };
  }

  return { match: null, similarity: 0 };
}
