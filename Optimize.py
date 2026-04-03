import pandas as pd
from itertools import combinations
from collections import defaultdict
import random
import time

# =====================================================
# CONFIGURATION
# =====================================================
MAX_STATIONS = 8
ANILOX_COLS = [f"Anilox{str(i).zfill(2)}" for i in range(1, MAX_STATIONS + 1)]
INK_COLS    = [f"Ink{str(i).zfill(2)}" for i in range(1, MAX_STATIONS + 1)]
STATIONS    = list(range(1, MAX_STATIONS + 1))

INKS_FORCE_800 = {"IBW1415", "IRW1374", "IYW751", "IBKW351"}  

ANILOX_CHANGE_COST = 7
INK_CHANGE_COST = 4          
STATION_ADD_COST = 1         

DECOMP_METHOD = "size"       
CHUNK_SIZE = 7
RANDOM_SEED = 7

USE_BEAM_LOCAL = True
USE_BEAM_GLOBAL = True

LOCAL_BEAM_WIDTH = 40
GLOBAL_BEAM_WIDTH = 30
VARIANTS_PER_CHUNK = 12      
KEEP_TOP_VARIANTS = 3        

STATION_COLS = [
    ('Station01_Anilox', 'Station01_Ink'),
    ('Station02_Anilox', 'Station02_Ink'),
    ('Station03_Anilox', 'Station03_Ink'),
    ('Station04_Anilox', 'Station04_Ink'),
    ('Station05_Anilox', 'Station05_Ink'),
    ('Station06_Anilox', 'Station06_Ink'),
    ('Station07_Anilox', 'Station07_Ink'),
    ('Station08_Anilox', 'Station08_Ink'),
]

# =====================================================
# STEP 1: COMBINATION GENERATION
# =====================================================
def _clean(v):
    if v is None or pd.isna(v):
        return None
    s = str(v).strip()
    return s if s != "" else None

def extract_packages_from_row(row, anilox_cols=ANILOX_COLS, ink_cols=INK_COLS, 
                              infer_anilox_from_ink=True, default_anilox_for_forced_800="FA800"):
    packages = []
    for a_col, i_col in zip(anilox_cols, ink_cols):
        a = _clean(row.get(a_col))
        i = _clean(row.get(i_col)) if i_col in row.index else None

        if a is None and i is None:
            continue

        if a is None and i is not None and infer_anilox_from_ink and i in INKS_FORCE_800:
            a = default_anilox_for_forced_800

        packages.append((a, i))
    return packages

def all_station_combos_for_packages(packages, stations=STATIONS):
    k = len(packages)
    if k == 0 or k > len(stations):
        return []

    out = []
    for chosen in combinations(stations, k):
        placement = {f"Station{str(s).zfill(2)}_Anilox": None for s in stations}
        placement.update({f"Station{str(s).zfill(2)}_Ink": None for s in stations})

        for s, (anilox, ink) in zip(chosen, packages):
            placement[f"Station{str(s).zfill(2)}_Anilox"] = anilox
            placement[f"Station{str(s).zfill(2)}_Ink"] = ink

        placement["ChosenStations"] = chosen
        out.append(placement)
    return out

def expand_designs_to_all_combinations(df, id_cols=None, infer_anilox_from_ink=True, 
                                       default_anilox_for_forced_800="FA800"):
    all_possible_anilox = [c for c in ANILOX_COLS if c in df.columns]
    all_possible_ink    = [c for c in INK_COLS if c in df.columns]

    if id_cols is None:
        id_cols = [c for c in df.columns if c not in set(all_possible_anilox + all_possible_ink)]

    out_rows = []
    for _, row in df.iterrows():
        packages = extract_packages_from_row(
            row,
            anilox_cols=all_possible_anilox + [c for c in ANILOX_COLS if c not in all_possible_anilox],
            ink_cols=all_possible_ink + [c for c in INK_COLS if c not in all_possible_ink],
            infer_anilox_from_ink=infer_anilox_from_ink,
            default_anilox_for_forced_800=default_anilox_for_forced_800
        )

        placements = all_station_combos_for_packages(packages)

        for combo_idx, placement in enumerate(placements, start=1):
            base = {c: row[c] for c in id_cols if c in row.index}
            base["NumPackages"] = len(packages)
            base["ComboIndex"] = combo_idx

            for c in all_possible_anilox:
                base[c] = row.get(c)
            for c in all_possible_ink:
                base[c] = row.get(c)

            base.update(placement)
            out_rows.append(base)

    return pd.DataFrame(out_rows)

# =====================================================
# STEP 2: SEQUENCE COST & OPTIMIZATION
# =====================================================
def base_code(x):
    if pd.isna(x) or str(x).strip() == "":
        return None
    return str(x).split("-")[0]

def normalize_stations_by_slot(row):
    stations = []
    for a_col, i_col in STATION_COLS:
        a = base_code(row.get(a_col))
        i = base_code(row.get(i_col))
        stations.append((a, i))
    return stations

def station_count(stations):
    return sum(1 for a, i in stations if a or i)

def init_state_from_combo(c):
    last_a, last_i = [None] * 8, [None] * 8
    for k in range(8):
        a, i = c["stations"][k]
        if a is not None: last_a[k] = a
        if i is not None: last_i[k] = i
    return (tuple(last_a), tuple(last_i))

def transition_cost_stateful(prev_c, curr_c, state):
    last_anilox, last_ink = list(state[0]), list(state[1])
    cost = 0

    prev_st = prev_c["stations"]
    curr_st = curr_c["stations"]

    for idx in range(8):
        aa, ai = prev_st[idx]
        pa, pi = last_anilox[idx], last_ink[idx]
        ca, ci = curr_st[idx]

        anilox_change = int(pa is not None and ca is not None and pa != ca)
        ink_change    = int(pi is not None and ci is not None and pi != ci)
        station_added = int(aa is None and ai is None and (ca is not None or ci is not None))

        cost += (anilox_change * ANILOX_CHANGE_COST + ink_change * INK_CHANGE_COST + station_added * STATION_ADD_COST)

        if ca is not None: last_anilox[idx] = ca
        if ci is not None: last_ink[idx] = ci

    return cost, (tuple(last_anilox), tuple(last_ink))

def total_sequence_cost(jobs_lut, seq):
    first = jobs_lut[seq[0]]
    state = init_state_from_combo(first)
    last_c = first
    total = 0
    for (j, combo) in seq[1:]:
        c = jobs_lut[(j, combo)]
        step, state = transition_cost_stateful(last_c, c, state)
        total += step
        last_c = c
    return total

def load_jobs(df, job_id_col="Shop Order"):
    jobs = defaultdict(list)
    for _, row in df.iterrows():
        stations = normalize_stations_by_slot(row)
        jobs[row[job_id_col]].append({
            "job": row[job_id_col],
            "combo": int(row["ComboIndex"]),
            "stations": stations,
            "station_count": station_count(stations),
        })
    return jobs

def prune_combos(jobs):
    pruned = {}
    for job, combos in jobs.items():
        seen = {}
        for c in combos:
            key = tuple(c["stations"])
            if key not in seen:
                seen[key] = c
        pruned[job] = list(seen.values())
    return pruned

def combo_lookup(jobs):
    return {(j, c["combo"]): c for j, combos in jobs.items() for c in combos}

def job_size(jobs, job_id):
    return max(c["station_count"] for c in jobs[job_id])

def make_chunks(job_ids, jobs, method="size", chunk_size=7, seed=7):
    job_ids = list(job_ids)
    if method == "random":
        random.Random(seed).shuffle(job_ids)
    else:
        job_ids.sort(key=lambda j: job_size(jobs, j), reverse=True)
    return [job_ids[i:i+chunk_size] for i in range(0, len(job_ids), chunk_size)]

def solve_chunk_beam(jobs, chunk_job_ids, beam_width=40, seed=7):
    ids = list(chunk_job_ids)
    beam = []

    for j in ids:
        for c in jobs[j]:
            state0 = init_state_from_combo(c)
            beam.append((0, [(j, c["combo"])], c, state0))

    for _ in range(len(ids) - 1):
        new_beam = []
        for cost_so_far, seq, last_c, state in beam:
            used = {jj for jj, _ in seq}
            for j in ids:
                if j in used: continue
                for c in jobs[j]:
                    step, new_state = transition_cost_stateful(last_c, c, state)
                    new_beam.append((cost_so_far + step, seq + [(j, c["combo"])], c, new_state))
        new_beam.sort(key=lambda x: x[0])
        beam = new_beam[:beam_width]

    return min(beam, key=lambda x: x[0])[1]

def chunk_variants(jobs, chunk_job_ids, variants=10, beam_width=40, seed=7):
    rng = random.Random(seed)
    lut = combo_lookup(jobs)
    seen, candidates = set(), []

    for k in range(variants):
        ids = list(chunk_job_ids)
        rng.shuffle(ids)
        seq = solve_chunk_beam(jobs, ids, beam_width=beam_width, seed=seed + 13*k)
        
        tup = tuple(seq)
        if tup in seen: continue
        seen.add(tup)
        
        candidates.append((total_sequence_cost(lut, seq), seq))

    candidates.sort(key=lambda x: x[0])
    return [seq for _, seq in candidates]

def stitch_chunks_beam(jobs, chunks, use_beam_global=True, global_beam_width=30, 
                       use_beam_local=True, local_beam_width=40, variants_per_chunk=10, 
                       keep_top_variants=3, seed=7, fix_first_chunk=False):
    lut = combo_lookup(jobs)
    all_chunk_vars = []

    for i, chunk in enumerate(chunks):
        vars_ = chunk_variants(jobs, chunk, variants=variants_per_chunk, 
                               beam_width=local_beam_width, seed=seed + 101*i)
        all_chunk_vars.append(vars_[:keep_top_variants])

    global_beam = []
    
    # Initialize with the restricted start chunks if requested
    start_indices = [0] if fix_first_chunk else range(len(chunks))
    
    for ci in start_indices:
        for v_seq in all_chunk_vars[ci]:
            first = lut[v_seq[0]]
            state = init_state_from_combo(first)
            last_c = first
            internal = 0
            for (j, combo) in v_seq[1:]:
                c = lut[(j, combo)]
                step, state = transition_cost_stateful(last_c, c, state)
                internal += step
                last_c = c
            global_beam.append((internal, (ci,), list(v_seq), last_c, state))

    global_beam.sort(key=lambda x: x[0])
    global_beam = global_beam[:global_beam_width]

    for _ in range(len(chunks) - 1):
        new_beam = []
        for cost_so_far, chosen, full_seq, last_c, state in global_beam:
            chosen_set = set(chosen)
            for ci, vars_ in enumerate(all_chunk_vars):
                if ci in chosen_set: continue
                for v_seq in vars_:
                    first_c = lut[v_seq[0]]
                    link_cost, link_state = transition_cost_stateful(last_c, first_c, state)

                    tmp_state = link_state
                    tmp_last = first_c
                    internal = 0
                    for (j, combo) in v_seq[1:]:
                        c = lut[(j, combo)]
                        step, tmp_state = transition_cost_stateful(tmp_last, c, tmp_state)
                        internal += step
                        tmp_last = c

                    new_beam.append((cost_so_far + link_cost + internal, chosen + (ci,), 
                                     full_seq + list(v_seq), tmp_last, tmp_state))

        new_beam.sort(key=lambda x: x[0])
        global_beam = new_beam[:global_beam_width] if use_beam_global else [new_beam[0]]

    return min(global_beam, key=lambda x: x[0])[2]

def append_missing_greedy(jobs, seq):
    lut = combo_lookup(jobs)
    used = {j for j, _ in seq}
    missing = [j for j in jobs.keys() if j not in used]
    if not missing:
        return seq

    first = lut[seq[0]]
    state = init_state_from_combo(first)
    last_c = first
    for (j, combo) in seq[1:]:
        c = lut[(j, combo)]
        _, state = transition_cost_stateful(last_c, c, state)
        last_c = c

    remaining = set(missing)
    while remaining:
        best = None
        for j in remaining:
            for c in jobs[j]:
                step, _ = transition_cost_stateful(last_c, c, state)
                if best is None or step < best[0]:
                    best = (step, j, c)
        step, j, c = best
        _, state = transition_cost_stateful(last_c, c, state)
        last_c = c
        seq.append((j, c["combo"]))
        remaining.remove(j)

    return seq

# =====================================================
# MAIN ENTRY FUNCTION
# =====================================================
def optimize_schedule(df, fix_first_job=True, job_id_col="Shop Order"):
    orig_cols = df.columns.tolist()

    # 1. Expand input to all possible station combinations
    expanded = expand_designs_to_all_combinations(
        df,
        id_cols=orig_cols,
        infer_anilox_from_ink=True,
        default_anilox_for_forced_800="FA800"
    )

    # 2. Prune combinations to unique physical sets per job
    jobs = prune_combos(load_jobs(expanded, job_id_col))

    # Identify job ids while preserving input appearance order
    job_ids = list(df[job_id_col].dropna().unique())

    # 3. Handle specific request to lock the first job
    if fix_first_job and len(job_ids) > 0:
        first_job = job_ids[0]
        rest_jobs = job_ids[1:]
        
        # Isolate the first job into its own chunk placed strictly at index 0
        chunks = [[first_job]] + make_chunks(rest_jobs, jobs, method=DECOMP_METHOD, 
                                             chunk_size=CHUNK_SIZE, seed=RANDOM_SEED)
        fix_first_chunk = True
    else:
        chunks = make_chunks(job_ids, jobs, method=DECOMP_METHOD, chunk_size=CHUNK_SIZE, seed=RANDOM_SEED)
        fix_first_chunk = False

    # 4. Generate optimized sequence globally
    best_sequence = stitch_chunks_beam(
        jobs, chunks,
        use_beam_global=USE_BEAM_GLOBAL, global_beam_width=GLOBAL_BEAM_WIDTH,
        use_beam_local=USE_BEAM_LOCAL, local_beam_width=LOCAL_BEAM_WIDTH,
        variants_per_chunk=VARIANTS_PER_CHUNK, keep_top_variants=KEEP_TOP_VARIANTS,
        seed=RANDOM_SEED, fix_first_chunk=fix_first_chunk
    )

    best_sequence = append_missing_greedy(jobs, list(best_sequence))

    # 5. Reconstruct Dataframe back to exact input specs
    expanded_indexed = expanded.set_index([job_id_col, "ComboIndex"])
    final_rows = []
    
    for job, combo in best_sequence:
        row_data = expanded_indexed.loc[(job, combo)].copy()
        
        if isinstance(row_data, pd.DataFrame):
            row_data = row_data.iloc[0].copy()
            
        row_data[job_id_col] = job 
        
        # Override original generic Anilox/Ink columns with their chosen station mappings
        for i in range(1, MAX_STATIONS + 1):
            a_col, i_col = f"Anilox{str(i).zfill(2)}", f"Ink{str(i).zfill(2)}"
            s_a_col, s_i_col = f"Station{str(i).zfill(2)}_Anilox", f"Station{str(i).zfill(2)}_Ink"
            
            if a_col in orig_cols: row_data[a_col] = row_data.get(s_a_col)
            if i_col in orig_cols: row_data[i_col] = row_data.get(s_i_col)
                
        final_rows.append(row_data)

    final_df = pd.DataFrame(final_rows)
    
    # Strictly return only the columns provided originally in the same order
    return final_df[orig_cols]
