import pandas as pd
import numpy as np

def count_empty_before_last_value_df(df):
    # 1. Create a boolean mask of non-empty cells
    # Check for both NaN AND empty strings since Excel empty cells come as ''
    not_empty_mask = (df.notna()) & (df != '')
    
    # 2. Find the index of the last non-empty cell for each row
    # We use cumsum on the columns in reverse order. 
    # Any cell where the reverse cumsum is > 0 means there is at least 
    # one non-empty cell at or after that position.
    # This effectively identifies all cells "before or at" the last non-empty cell.
    mask_up_to_last = not_empty_mask.iloc[:, ::-1].cumsum(axis=1).iloc[:, ::-1] > 0
    
    # 3. Count empty cells within that masked area
    # We want cells that are:
    # (A) Empty (isna() OR empty string) AND (B) Before the last non-empty cell (mask_up_to_last)
    is_empty = (df.isna()) | (df == '')
    empty_counts = (is_empty & mask_up_to_last).sum(axis=1)
    
    return empty_counts

def count_changes_in_dataframe(df):
    results = {}
    # 1. Iterate through each column in the DataFrame
    for col_name in df.columns:
        series = df[col_name]
        
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

    # Third, count of empty before-last anilox cells, indicating skipped stations
    skipped_counts = count_empty_before_last_value_df(df.iloc[:, 5:13])
    number_skipped_stations = skipped_counts.sum()

    total_score = (7 * total_anilox_changes) + (4 * total_ink_changes) + number_skipped_stations
    
    return {
        "total_score": total_score,
        "anilox_changes": total_anilox_changes,
        "ink_changes": total_ink_changes,
        "skipped_stations": number_skipped_stations,
        "anilox_details": anilox_change_counts,
        "ink_details": ink_change_counts
    }
