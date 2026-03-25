import pandas as pd
import numpy as np

def count_empty_to_filled_transitions_df(df):
    
    results = {}

    for col_name in df.columns:
        # 1. Process the next column
        series = df[col_name]
        
        # 2. Identify which cells are empty (True) and which are filled (False)
        is_empty = series.isna()
        
        # 3. Shift the "is_empty" status by 1 row
        # This allows us to see what the state was in the row above
        was_empty_previously = is_empty.shift(1, fill_value=False)
        
        # 4. Define the logic:
        # We want rows where:
        # (A) The current cell is NOT empty (~is_empty)
        # AND (B) The previous cell WAS empty (was_empty_previously)
        transition_mask = (~is_empty) & (was_empty_previously)
        
        # 5. Sum the True values
        results[col_name] = int(transition_mask.sum())
    
    return results

def count_changes_in_dataframe(df):
    results = {}
    # 1. Iterate through each column in the DataFrame
    for col_name in df.columns:
        series = df[col_name].astype(str).str.split('-').str[0]
        
        # 2. Replace empty strings with NaN so ffill() can forward fill them
        series_with_nan = series.replace('', np.nan)
        
        # 3. Forward fill ensures empty cells (now NaN) are treated as the "last known value"
        filled_series = series_with_nan.ffill().fillna("")
        
        # 4. Compare current row to previous row
        # We sum the instances where the current value != previous value
        changes = (filled_series != filled_series.shift()).iloc[1:].sum()
        
        results[col_name] = int(changes)
    
    return results

def calculate_score(df):
    # First, count changes in Anilox 
    anilox_change_counts = count_changes_in_dataframe(df.iloc[:, 5:13])
    total_anilox_changes = sum(anilox_change_counts.values())

    # Second, count changes in Ink 
    ink_change_counts = count_changes_in_dataframe(df.iloc[:, 13:21])
    total_ink_changes = sum(ink_change_counts.values())

    # Third, count of empty before-last anilox cells, indicating added stations
    added_counts = count_empty_to_filled_transitions_df(df.iloc[:, 5:13])
    number_added_stations = added_counts.sum()

    total_score = (7 * total_anilox_changes) + (4 * total_ink_changes) + number_added_stations
    
    return {
        "total_score": total_score,
        "anilox_changes": total_anilox_changes,
        "ink_changes": total_ink_changes,
        "added_stations": number_added_stations,
        "anilox_details": anilox_change_counts,
        "ink_details": ink_change_counts,
        "added_station_details": added_counts
    }
