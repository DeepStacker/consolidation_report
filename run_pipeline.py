import os
import sys


def resource_base():
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return sys._MEIPASS
    return os.path.dirname(os.path.abspath(__file__))


def workspace_base():
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


def ensure_config(ws: str, rb: str):
    config_dir = os.path.join(ws, "config", "schemas")
    if os.path.exists(config_dir):
        return
    src = os.path.join(rb, "config", "schemas")
    if not os.path.exists(src):
        return
    os.makedirs(config_dir, exist_ok=True)
    import shutil
    for f in os.listdir(src):
        shutil.copy2(os.path.join(src, f), os.path.join(config_dir, f))


def print_banner(ws: str):
    xlsx_files = [f for f in os.listdir(ws) if f.endswith(".xlsx")]
    print("=" * 64)
    print("   CONSOLIDATION PIPELINE")
    print("=" * 64)
    print(f"   Working in: {ws}")
    print(f"   Excel files found: {len(xlsx_files)}")
    for f in xlsx_files:
        print(f"     - {f}")
    if not xlsx_files:
        print()
        print("   ⚠ No Excel files found!")
        print("   Place this program in the folder with your")
        print("   source Excel workbooks, then run it again.")
        print("=" * 64)
        print()
        input("Press Enter to exit...")
        sys.exit(1)
    print("=" * 64)
    print()


if __name__ == "__main__":
    ws = workspace_base()
    rb = resource_base()
    os.chdir(ws)
    print_banner(ws)
    ensure_config(ws, rb)

    sys.path.insert(0, rb)
    from src.main import execute_e2e_consolidation

    target_xlsx = os.path.join(ws, "Feb'26 consolidated.xlsx")
    try:
        execute_e2e_consolidation(ws, target_xlsx)
    except Exception as e:
        print()
        print("=" * 64)
        print("   ERROR: Something went wrong.")
        print(f"   {e}")
        print()
        print("   Make sure your Excel files are in the same")
        print("   folder as this program and try again.")
        print("=" * 64)
        print()
        input("Press Enter to exit...")
        sys.exit(1)
    else:
        print()
        print("=" * 64)
        print("   DONE! Open the consolidated file in Excel")
        print("   to review the results.")
        print("=" * 64)
        print()
        input("Press Enter to exit...")
