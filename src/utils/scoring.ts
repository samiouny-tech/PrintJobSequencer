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
  
  // Split values by '-' and take the first part
  const processedData = columnData.map(val => (val || "").split('-')[0]);
  
  // Forward fill empty cells
  const filled = ffill(processedData);
  
  let changes = 0;
  for (let i = 1; i < filled.length; i++) {
    if (filled[i] !== filled[i - 1]) {
      changes++;
    }
  }
  return changes;
}

function countEmptyToFilledTransitions(columnData: string[]): number {
  let transitions = 0;
  for (let i = 1; i < columnData.length; i++) {
    const currentEmpty = columnData[i] === "" || columnData[i] === undefined || columnData[i] === null;
    const previousEmpty = columnData[i - 1] === "" || columnData[i - 1] === undefined || columnData[i - 1] === null;
    
    // Transition: was empty, now NOT empty
    if (!currentEmpty && previousEmpty) {
      transitions++;
    }
  }
  return transitions;
}

export function calculateScore(headers: string[], rows: string[][], aniloxIndices: number[], inkIndices: number[]): ScoreResults {
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
  
  const addedStationDetails: Record<string, number> = {};
  let totalAdded = 0;
  for (const idx of aniloxIndices) {
    const colData = rows.map(r => r[idx] || "");
    const added = countEmptyToFilledTransitions(colData);
    addedStationDetails[headers[idx]] = added;
    totalAdded += added;
  }
  
  const totalScore = (7 * totalAniloxChanges) + (4 * totalInkChanges) + totalAdded;
  
  return {
    total_score: totalScore,
    anilox_changes: totalAniloxChanges,
    ink_changes: totalInkChanges,
    added_stations: totalAdded,
    anilox_details: aniloxDetails,
    ink_details: inkDetails,
    added_station_details: addedStationDetails
  };
}
