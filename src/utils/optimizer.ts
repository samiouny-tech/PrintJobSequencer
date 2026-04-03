
/**
 * Ported from Optimize.py
 */

export const MAX_STATIONS = 8;
export const ANILOX_COLS = Array.from({ length: MAX_STATIONS }, (_, i) => `Anilox${String(i + 1).padStart(2, '0')}`);
export const INK_COLS = Array.from({ length: MAX_STATIONS }, (_, i) => `Ink${String(i + 1).padStart(2, '0')}`);
export const STATIONS = Array.from({ length: MAX_STATIONS }, (_, i) => i + 1);

export const INKS_FORCE_800 = new Set(["IBW1415", "IRW1374", "IYW751", "IBKW351"]);

export const ANILOX_CHANGE_COST = 7;
export const INK_CHANGE_COST = 4;
export const STATION_ADD_COST = 1;

export const DECOMP_METHOD = "size";
export const CHUNK_SIZE = 7;
export const RANDOM_SEED = 7;

export const USE_BEAM_LOCAL = true;
export const USE_BEAM_GLOBAL = true;

export const LOCAL_BEAM_WIDTH = 40;
export const GLOBAL_BEAM_WIDTH = 30;
export const VARIANTS_PER_CHUNK = 12;
export const KEEP_TOP_VARIANTS = 3;

export const STATION_COLS = Array.from({ length: MAX_STATIONS }, (_, i) => [
  `Station${String(i + 1).padStart(2, '0')}_Anilox`,
  `Station${String(i + 1).padStart(2, '0')}_Ink`
]);

// Helper for combinations
function getCombinations<T>(array: T[], k: number): T[][] {
  const result: T[][] = [];
  function backtrack(start: number, current: T[]) {
    if (current.length === k) {
      result.push([...current]);
      return;
    }
    for (let i = start; i < array.length; i++) {
      current.push(array[i]);
      backtrack(i + 1, current);
      current.pop();
    }
  }
  backtrack(0, []);
  return result;
}

// Simple seeded random
class SeededRandom {
  private seed: number;
  constructor(seed: number) {
    this.seed = seed;
  }
  next() {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }
  shuffle<T>(array: T[]) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }
}

function _clean(v: any): string | null {
  if (v === null || v === undefined || (typeof v === 'number' && isNaN(v))) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function extractPackagesFromRow(row: any, headers: string[]): [string | null, string | null][] {
  const packages: [string | null, string | null][] = [];
  const rowMap = new Map(headers.map((h, i) => [h, row[i]]));

  for (let idx = 0; idx < MAX_STATIONS; idx++) {
    const aCol = ANILOX_COLS[idx];
    const iCol = INK_COLS[idx];

    let a = _clean(rowMap.get(aCol));
    let i = _clean(rowMap.get(iCol));

    if (a === null && i === null) continue;

    if (a === null && i !== null && INKS_FORCE_800.has(i)) {
      a = "FA800";
    }

    packages.push([a, i]);
  }
  return packages;
}

function allStationCombosForPackages(packages: [string | null, string | null][]): any[] {
  const k = packages.length;
  if (k === 0 || k > MAX_STATIONS) return [];

  const out: any[] = [];
  const combos = getCombinations(STATIONS, k);

  for (const chosen of combos) {
    const placement: any = {};
    for (let s = 1; s <= MAX_STATIONS; s++) {
      placement[`Station${String(s).padStart(2, '0')}_Anilox`] = null;
      placement[`Station${String(s).padStart(2, '0')}_Ink`] = null;
    }

    for (let i = 0; i < k; i++) {
      const s = chosen[i];
      const [anilox, ink] = packages[i];
      placement[`Station${String(s).padStart(2, '0')}_Anilox`] = anilox;
      placement[`Station${String(s).padStart(2, '0')}_Ink`] = ink;
    }
    placement.ChosenStations = chosen;
    out.push(placement);
  }
  return out;
}

function baseCode(x: any): string | null {
  const cleaned = _clean(x);
  if (!cleaned) return null;
  return cleaned.split("-")[0];
}

function normalizeStationsBySlot(row: any): [string | null, string | null][] {
  return STATION_COLS.map(([aCol, iCol]) => [
    baseCode(row[aCol]),
    baseCode(row[iCol])
  ]);
}

function stationCount(stations: [string | null, string | null][]): number {
  return stations.filter(([a, i]) => a !== null || i !== null).length;
}

function initStateFromCombo(c: any): [any[], any[]] {
  const lastA = Array(8).fill(null);
  const lastI = Array(8).fill(null);
  for (let k = 0; k < 8; k++) {
    const [a, i] = c.stations[k];
    if (a !== null) lastA[k] = a;
    if (i !== null) lastI[k] = i;
  }
  return [lastA, lastI];
}

function transitionCostStateful(prevC: any, currC: any, state: [any[], any[]]): [number, [any[], any[]]] {
  const lastAnilox = [...state[0]];
  const lastInk = [...state[1]];
  let cost = 0;

  const prevSt = prevC.stations;
  const currSt = currC.stations;

  for (let idx = 0; idx < 8; idx++) {
    const [aa, ai] = prevSt[idx];
    const pa = lastAnilox[idx];
    const pi = lastInk[idx];
    const [ca, ci] = currSt[idx];

    const aniloxChange = (pa !== null && ca !== null && pa !== ca) ? 1 : 0;
    const inkChange = (pi !== null && ci !== null && pi !== ci) ? 1 : 0;
    const stationAdded = (aa === null && ai === null && (ca !== null || ci !== null)) ? 1 : 0;

    cost += (aniloxChange * ANILOX_CHANGE_COST + inkChange * INK_CHANGE_COST + stationAdded * STATION_ADD_COST);

    if (ca !== null) lastAnilox[idx] = ca;
    if (ci !== null) lastInk[idx] = ci;
  }

  return [cost, [lastAnilox, lastInk]];
}

function totalSequenceCost(jobsLut: Map<string, any>, seq: [string, number][]): number {
  const first = jobsLut.get(`${seq[0][0]}_${seq[0][1]}`);
  let state = initStateFromCombo(first);
  let lastC = first;
  let total = 0;
  for (let i = 1; i < seq.length; i++) {
    const [j, combo] = seq[i];
    const c = jobsLut.get(`${j}_${combo}`);
    const [step, newState] = transitionCostStateful(lastC, c, state);
    total += step;
    state = newState;
    lastC = c;
  }
  return total;
}

function solveChunkBeam(jobs: Map<string, any[]>, chunkJobIds: string[], beamWidth: number = 40): [string, number][] {
  const ids = [...chunkJobIds];
  let beam: [number, [string, number][], any, [any[], any[]]][] = [];

  for (const j of ids) {
    const combos = jobs.get(j) || [];
    for (const c of combos) {
      const state0 = initStateFromCombo(c);
      beam.push([0, [[j, c.combo]], c, state0]);
    }
  }

  for (let step = 0; step < ids.length - 1; step++) {
    const newBeam: [number, [string, number][], any, [any[], any[]]][] = [];
    for (const [costSoFar, seq, lastC, state] of beam) {
      const used = new Set(seq.map(([jj]) => jj));
      for (const j of ids) {
        if (used.has(j)) continue;
        const combos = jobs.get(j) || [];
        for (const c of combos) {
          const [stepCost, newState] = transitionCostStateful(lastC, c, state);
          newBeam.push([costSoFar + stepCost, [...seq, [j, c.combo]], c, newState]);
        }
      }
    }
    newBeam.sort((a, b) => a[0] - b[0]);
    beam = newBeam.slice(0, beamWidth);
  }

  return beam.sort((a, b) => a[0] - b[0])[0][1];
}

function chunkVariants(jobs: Map<string, any[]>, chunkJobIds: string[], variants: number = 10, beamWidth: number = 40, seed: number = 7): [string, number][][] {
  const rng = new SeededRandom(seed);
  const jobsLut = new Map<string, any>();
  for (const [j, combos] of jobs.entries()) {
    for (const c of combos) {
      jobsLut.set(`${j}_${c.combo}`, c);
    }
  }

  const seen = new Set<string>();
  const candidates: [number, [string, number][]][] = [];

  for (let k = 0; k < variants; k++) {
    const ids = [...chunkJobIds];
    rng.shuffle(ids);
    const seq = solveChunkBeam(jobs, ids, beamWidth);
    const key = JSON.stringify(seq);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push([totalSequenceCost(jobsLut, seq), seq]);
  }

  candidates.sort((a, b) => a[0] - b[0]);
  return candidates.map(([_, seq]) => seq);
}

function jobPhysicalSignature(jobs: Map<string, any[]>, jobId: string): string {
  const jobCombos = jobs.get(jobId);
  if (!jobCombos || jobCombos.length === 0) return "";
  
  const stations = jobCombos[0].stations;
  const elements: string[] = [];
  for (const [a, i] of stations) {
    if (a !== null) elements.push(String(a));
    if (i !== null) elements.push(String(i));
  }
  elements.sort();
  return elements.join("");
}

export function optimizeSchedule(headers: string[], data: any[][], fixFirstJob: boolean = true, jobIdCol: string = "Shop Order"): { headers: string[], data: any[][] } {
  const jobIdIdx = headers.indexOf(jobIdCol);
  if (jobIdIdx === -1) throw new Error(`Column ${jobIdCol} not found`);

  // 1. Expand
  const expandedRows: any[] = [];
  for (const row of data) {
    const packages = extractPackagesFromRow(row, headers);
    const placements = allStationCombosForPackages(packages);
    const idData: any = {};
    headers.forEach((h, i) => {
      if (!ANILOX_COLS.includes(h) && !INK_COLS.includes(h)) {
        idData[h] = row[i];
      }
    });

    placements.forEach((placement, comboIdx) => {
      const base = { ...idData, NumPackages: packages.length, ComboIndex: comboIdx + 1 };
      ANILOX_COLS.forEach((h, i) => {
        const idx = headers.indexOf(h);
        if (idx !== -1) base[h] = row[idx];
      });
      INK_COLS.forEach((h, i) => {
        const idx = headers.indexOf(h);
        if (idx !== -1) base[h] = row[idx];
      });
      expandedRows.push({ ...base, ...placement });
    });
  }

  // 2. Load and Prune
  const jobsMap = new Map<string, any[]>();
  expandedRows.forEach(row => {
    const job = String(row[jobIdCol]);
    if (!jobsMap.has(job)) jobsMap.set(job, []);
    const stations = normalizeStationsBySlot(row);
    jobsMap.get(job)!.push({
      job,
      combo: row.ComboIndex,
      stations,
      stationCount: stationCount(stations),
      row
    });
  });

  const prunedJobs = new Map<string, any[]>();
  for (const [job, combos] of jobsMap.entries()) {
    const seen = new Set<string>();
    const pruned: any[] = [];
    combos.forEach(c => {
      const key = JSON.stringify(c.stations);
      if (!seen.has(key)) {
        seen.add(key);
        pruned.push(c);
      }
    });
    prunedJobs.set(job, pruned);
  }

  const jobIds = Array.from(new Set(data.map(r => String(r[jobIdIdx])).filter(v => v !== "null" && v !== "")));

  // 3. Chunks
  const makeChunks = (ids: string[]) => {
    const sorted = [...ids].sort((a, b) => {
      const sizeA = Math.max(...prunedJobs.get(a)!.map(c => c.stationCount));
      const sizeB = Math.max(...prunedJobs.get(b)!.map(c => c.stationCount));
      
      if (sizeB !== sizeA) return sizeB - sizeA;
      
      const sigA = jobPhysicalSignature(prunedJobs, a);
      const sigB = jobPhysicalSignature(prunedJobs, b);
      
      if (sigB !== sigA) return sigB > sigA ? 1 : -1;
      
      return 0;
    });
    const chunks: string[][] = [];
    for (let i = 0; i < sorted.length; i += CHUNK_SIZE) {
      chunks.push(sorted.slice(i, i + CHUNK_SIZE));
    }
    return chunks;
  };

  let chunks: string[][];
  let fixFirstChunk = false;
  if (fixFirstJob && jobIds.length > 0) {
    const firstJob = jobIds[0];
    const restJobs = jobIds.slice(1);
    chunks = [[firstJob], ...makeChunks(restJobs)];
    fixFirstChunk = true;
  } else {
    chunks = makeChunks(jobIds);
  }

  // 4. Stitch
  const jobsLut = new Map<string, any>();
  for (const [j, combos] of prunedJobs.entries()) {
    for (const c of combos) {
      jobsLut.set(`${j}_${c.combo}`, c);
    }
  }

  const allChunkVars = chunks.map((chunk, i) => {
    const vars = chunkVariants(prunedJobs, chunk, VARIANTS_PER_CHUNK, LOCAL_BEAM_WIDTH, RANDOM_SEED + 101 * i);
    return vars.slice(0, KEEP_TOP_VARIANTS);
  });

  let globalBeam: [number, number[], [string, number][], any, [any[], any[]]][] = [];
  const startIndices = fixFirstChunk ? [0] : Array.from({ length: chunks.length }, (_, i) => i);

  for (const ci of startIndices) {
    for (const vSeq of allChunkVars[ci]) {
      const first = jobsLut.get(`${vSeq[0][0]}_${vSeq[0][1]}`);
      let state = initStateFromCombo(first);
      let lastC = first;
      let internal = 0;
      for (let i = 1; i < vSeq.length; i++) {
        const [j, combo] = vSeq[i];
        const c = jobsLut.get(`${j}_${combo}`);
        const [step, newState] = transitionCostStateful(lastC, c, state);
        internal += step;
        state = newState;
        lastC = c;
      }
      globalBeam.push([internal, [ci], vSeq, lastC, state]);
    }
  }

  globalBeam.sort((a, b) => a[0] - b[0]);
  globalBeam = globalBeam.slice(0, GLOBAL_BEAM_WIDTH);

  for (let step = 0; step < chunks.length - 1; step++) {
    const newBeam: [number, number[], [string, number][], any, [any[], any[]]][] = [];
    for (const [costSoFar, chosen, fullSeq, lastC, state] of globalBeam) {
      const chosenSet = new Set(chosen);
      for (let ci = 0; ci < allChunkVars.length; ci++) {
        if (chosenSet.has(ci)) continue;
        for (const vSeq of allChunkVars[ci]) {
          const firstC = jobsLut.get(`${vSeq[0][0]}_${vSeq[0][1]}`);
          const [linkCost, linkState] = transitionCostStateful(lastC, firstC, state);

          let tmpState = linkState;
          let tmpLast = firstC;
          let internal = 0;
          for (let i = 1; i < vSeq.length; i++) {
            const [j, combo] = vSeq[i];
            const c = jobsLut.get(`${j}_${combo}`);
            const [stepCost, newState] = transitionCostStateful(tmpLast, c, tmpState);
            internal += stepCost;
            tmpState = newState;
            tmpLast = c;
          }
          newBeam.push([costSoFar + linkCost + internal, [...chosen, ci], [...fullSeq, ...vSeq], tmpLast, tmpState]);
        }
      }
    }
    newBeam.sort((a, b) => a[0] - b[0]);
    globalBeam = newBeam.slice(0, GLOBAL_BEAM_WIDTH);
  }

  const bestSequence = globalBeam.sort((a, b) => a[0] - b[0])[0][2];
  const bestCost = totalSequenceCost(jobsLut, bestSequence);
  console.log("Best Cost:", bestCost);

  // 5. Reconstruct
  const finalData: any[][] = [];
  for (const [job, combo] of bestSequence) {
    const c = jobsLut.get(`${job}_${combo}`);
    const rowData = { ...c.row };
    
    for (let i = 1; i <= MAX_STATIONS; i++) {
      const aCol = `Anilox${String(i).padStart(2, '0')}`;
      const iCol = `Ink${String(i).padStart(2, '0')}`;
      const sACol = `Station${String(i).padStart(2, '0')}_Anilox`;
      const sICol = `Station${String(i).padStart(2, '0')}_Ink`;
      
      if (headers.includes(aCol)) rowData[aCol] = rowData[sACol];
      if (headers.includes(iCol)) rowData[iCol] = rowData[sICol];
    }
    
    finalData.push(headers.map(h => rowData[h]));
  }

  return { headers, data: finalData };
}
