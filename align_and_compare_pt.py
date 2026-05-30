import pandas as pd
import numpy as np

def align_and_compare_pt():
    sys_file = "Feb'26 consolidated.xlsx"
    man_file = "Feb'26 consolidated_backup.xlsx"
    
    df_sys = pd.read_excel(sys_file, sheet_name="Payment Tracker")
    df_man = pd.read_excel(man_file, sheet_name="Payment Tracker")
    
    # Drop totals and spacer rows (rows where Assayer Code is null)
    df_sys_clean = df_sys[df_sys['Assayer Code'].notna()].copy()
    df_man_clean = df_man[df_man['Assayer Code'].notna()].copy()
    
    print(f"Clean System PT rows: {len(df_sys_clean)}")
    print(f"Clean Manual PT rows: {len(df_man_clean)}")
    
    # Set index to composite key for matching
    df_sys_clean['match_key'] = df_sys_clean['client'] + "_" + df_sys_clean['Assayer Code']
    df_man_clean['match_key'] = df_man_clean['client'] + "_" + df_man_clean['Assayer Code']
    
    df_sys_clean.set_index('match_key', inplace=True)
    df_man_clean.set_index('match_key', inplace=True)
    
    # Common keys
    common_keys = set(df_sys_clean.index).intersection(set(df_man_clean.index))
    print(f"Common keys: {len(common_keys)}")
    
    keys_in_sys_only = set(df_sys_clean.index) - set(df_man_clean.index)
    keys_in_man_only = set(df_man_clean.index) - set(df_sys_clean.index)
    
    print(f"Keys in System but missing in Manual: {keys_in_sys_only}")
    print(f"Keys in Manual but missing in System: {keys_in_man_only}")
    
    # Detailed compare on common keys
    columns_to_compare = [c for c in df_sys_clean.columns if c not in ['S.no', 'client', 'match_key']]
    
    field_mismatches = 0
    mismatch_details = []
    
    for key in common_keys:
        row_sys = df_sys_clean.loc[key]
        row_man = df_man_clean.loc[key]
        
        # Handle duplicate indices if any
        if isinstance(row_sys, pd.DataFrame):
            row_sys = row_sys.iloc[0]
        if isinstance(row_man, pd.DataFrame):
            row_man = row_man.iloc[0]
            
        for col in columns_to_compare:
            val_sys = row_sys[col]
            val_man = row_man[col]
            
            is_sys_null = pd.isna(val_sys)
            is_man_null = pd.isna(val_man)
            
            if is_sys_null and is_man_null:
                continue
            elif is_sys_null != is_man_null:
                field_mismatches += 1
                mismatch_details.append((key, col, val_sys, val_man, "Null mismatch"))
            else:
                if isinstance(val_sys, (int, float)) and isinstance(val_man, (int, float)):
                    if round(val_sys, 2) != round(val_man, 2):
                        field_mismatches += 1
                        mismatch_details.append((key, col, val_sys, val_man, "Numeric mismatch"))
                else:
                    if str(val_sys).strip() != str(val_man).strip():
                        field_mismatches += 1
                        mismatch_details.append((key, col, val_sys, val_man, "String mismatch"))
                        
    print(f"\nTotal field value mismatches after alignment: {field_mismatches}")
    if field_mismatches > 0:
        print("First 20 mismatches:")
        for m in mismatch_details[:20]:
            print(f"  Key: {m[0]} | Col: '{m[1]}' | System: '{m[2]}' | Manual: '{m[3]}' | Type: {m[4]}")

if __name__ == "__main__":
    align_and_compare_pt()
