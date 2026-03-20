import { ScoreResults } from '../types';

/**
 * Ported logic from module1.py
 */

function ffill(arr: string[]): string[] {
  const result = [...arr];
  let lastVal = "";
  for (let i = 0; i < result.length; i++) {
    if (result[i] === "" || result[i] === undefined || result[i] === null) {
      result[i] = lastVal;
    } else {
      lastVal = result[i];
    }
  }
  return result;
}

function countChangesInColumn(columnData: string[]): number {
  if (columnData.length <= 1) return 0;
  
  // Forward fill empty cells
  const filled = ffill(columnData);
  
  let changes = 0;
  for (let i = 1; i < filled.length; i++) {
    if (filled[i] !== filled[i - 1]) {
      changes++;
    }
  }
  return changes;
}

function countEmptyBeforeLast(row: string[]): number {
  // Find last non-empty index
  let lastIdx = -1;
  for (let i = row.length - 1; i >= 0; i--) {
    if (row[i] !== "" && row[i] !== undefined && row[i] !== null) {
      lastIdx = i;
      break;
    }
  }
  
  if (lastIdx === -1) return 0;
  
  let emptyCount = 0;
  for (let i = 0; i < lastIdx; i++) {
    if (row[i] === "" || row[i] === undefined || row[i] === null) {
      emptyCount++;
    }
  }
  return emptyCount;
}

export function calculateScore(headers: string[], rows: string[][]): ScoreResults {
  // Anilox columns: 5 to 12 (0-indexed)
  // Ink columns: 13 to 20 (0-indexed)
  
  const aniloxIndices = [5, 6, 7, 8, 9, 10, 11, 12];
  const inkIndices = [13, 14, 15, 16, 17, 18, 19, 20];
  
  const aniloxDetails: Record<string, number> = {};
  let totalAniloxChanges = 0;
  
  for (const idx of aniloxIndices) {
    const colData = rows.map(r => r[idx] || "");
    const changes = countChangesInColumn(colData);
    aniloxDetails[headers[idx]] = changes;
    totalAniloxChanges += changes;
  }
  
  const inkDetails: Record<string, number> = {};
  let totalInkChanges = 0;
  
  for (const idx of inkIndices) {
    const colData = rows.map(r => r[idx] || "");
    const changes = countChangesInColumn(colData);
    inkDetails[headers[idx]] = changes;
    totalInkChanges += changes;
  }
  
  let totalSkipped = 0;
  for (const row of rows) {
    const aniloxRow = aniloxIndices.map(idx => row[idx] || "");
    totalSkipped += countEmptyBeforeLast(aniloxRow);
  }
  
  const totalScore = (7 * totalAniloxChanges) + (4 * totalInkChanges) + totalSkipped;
  
  return {
    total_score: totalScore,
    anilox_changes: totalAniloxChanges,
    ink_changes: totalInkChanges,
    skipped_stations: totalSkipped,
    anilox_details: aniloxDetails,
    ink_details: inkDetails
  };
}
