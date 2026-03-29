/**
 * Deduplication & Question Submission API
 * Handles question submission with automatic deduplication
 * If a similar question exists, increments count instead of creating new entry
 */

import {
  collection,
  query,
  where,
  getDocs,
  doc,
  setDoc,
  updateDoc,
  serverTimestamp,
  increment,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  calculateSimilarity,
  calculateKeywordOverlap,
  normalizeQuestionText,
} from '../utils/question-similarity';

export type SubmitQuestionResponse = {
  success: boolean;
  questionId: string;
  isDuplicate: boolean;
  count: number;
  message: string;
};

/**
 * Find similar existing question in current session
 */
async function findSimilarQuestion(
  sessionId: string,
  newQuestionText: string,
  similarityThreshold: number = 0.75
): Promise<{ docId: string; data: any } | null> {
  try {
    const questionsRef = collection(db, 'sessions', sessionId, 'questions');
    const snapshot = await getDocs(questionsRef);

    let bestMatch = null;
    let bestSimilarity = 0;

    snapshot.forEach((doc) => {
      const data = doc.data();
      const existingText = data.text || '';

      // Calculate combined similarity
      const textSim = calculateSimilarity(newQuestionText, existingText);
      const keywordSim = calculateKeywordOverlap(newQuestionText, existingText);

      // Use weighted average (text similarity is more important)
      const combinedSim = textSim * 0.7 + keywordSim * 0.3;

      if (combinedSim > bestSimilarity && combinedSim >= similarityThreshold) {
        bestSimilarity = combinedSim;
        bestMatch = { docId: doc.id, data: data };
      }
    });

    return bestMatch;
  } catch (error) {
    console.error('Error finding similar question:', error);
    return null;
  }
}

/**
 * Main function: Submit question with deduplication
 *
 * Firestore structure:
 * sessions/{sessionId}/questions/{questionId}
 * {
 *   text: string (original question text)
 *   count: number (how many times asked)
 *   lastAskedAt: timestamp
 *   ids: string[] (array of original question doc IDs for audit trail)
 *   askedAt: timestamp (timestamp of first question)
 *   studentIds: string[] (array of student IDs who asked similar questions)
 * }
 */
export async function submitQuestionWithDedup(
  sessionId: string,
  questionText: string,
  studentId: string,
  similarityThreshold: number = 0.75
): Promise<SubmitQuestionResponse> {
  try {
    questionText = questionText.trim();

    if (!questionText) {
      return {
        success: false,
        questionId: '',
        isDuplicate: false,
        count: 0,
        message: 'Question cannot be empty',
      };
    }

    if (!sessionId || !studentId) {
      return {
        success: false,
        questionId: '',
        isDuplicate: false,
        count: 0,
        message: 'Missing sessionId or studentId',
      };
    }

    // Search for similar question
    const similarMatch = await findSimilarQuestion(
      sessionId,
      questionText,
      similarityThreshold
    );

    if (similarMatch) {
      // Found similar question → increment count
      const questionsRef = doc(
        db,
        'sessions',
        sessionId,
        'questions',
        similarMatch.docId
      );

      const newCount = (similarMatch.data.count || 1) + 1;
      const studentIds = similarMatch.data.studentIds || [];

      // Avoid duplicate student IDs in the array
      if (!studentIds.includes(studentId)) {
        studentIds.push(studentId);
      }

      await updateDoc(questionsRef, {
        count: newCount,
        lastAskedAt: serverTimestamp(),
        studentIds: studentIds,
      });

      return {
        success: true,
        questionId: similarMatch.docId,
        isDuplicate: true,
        count: newCount,
        message: `Question merged with existing one (${newCount} similar questions total)`,
      };
    } else {
      // No similar question → create new entry
      const questionsRef = collection(db, 'sessions', sessionId, 'questions');

      const newDocRef = await import('firebase/firestore').then((m) =>
        m.addDoc(questionsRef, {
          text: questionText,
          count: 1,
          askedAt: serverTimestamp(),
          lastAskedAt: serverTimestamp(),
          upvotes: 0,
          studentId: studentId,
          studentIds: [studentId],
        })
      );

      return {
        success: true,
        questionId: newDocRef.id,
        isDuplicate: false,
        count: 1,
        message: 'Question submitted successfully',
      };
    }
  } catch (error) {
    console.error('Error submitting question with dedup:', error);
    return {
      success: false,
      questionId: '',
      isDuplicate: false,
      count: 0,
      message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Get all questions from session sorted by priority
 *
 * Priority calculation:
 * 1. Higher count = higher priority
 * 2. If same count, newer lastAskedAt = higher priority
 */
export async function getQuestionsWithPriority(
  sessionId: string
): Promise<
  Array<{
    id: string;
    text: string;
    count: number;
    priority: number;
    lastAskedAt: any;
    askedAt: any;
    studentIds: string[];
  }>
> {
  try {
    const questionsRef = collection(db, 'sessions', sessionId, 'questions');
    const snapshot = await getDocs(questionsRef);

    const questions = snapshot.docs.map((doc) => {
      const data = doc.data();
      const count = data.count || 1;

      // Priority = count (weighted more) + timestamp adjustment
      // More recent questions get slight boost
      const recencyBoost =
        data.lastAskedAt?.toDate
          ? (new Date(data.lastAskedAt.toDate()).getTime() - Date.now()) / 1000000
          : 0;

      const priority = count * 100 + recencyBoost;

      return {
        id: doc.id,
        text: data.text || '',
        count: count,
        priority: priority,
        lastAskedAt: data.lastAskedAt,
        askedAt: data.askedAt,
        studentIds: data.studentIds || [],
      };
    });

    // Sort by priority (descending)
    questions.sort((a, b) => b.priority - a.priority);

    return questions;
  } catch (error) {
    console.error('Error getting prioritized questions:', error);
    return [];
  }
}
