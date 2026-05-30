import os
import sys
import shutil
import tempfile
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, scrolledtext

OUTPUT_FILENAME = "Consolidated_Report.xlsx"

def resource_base():
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return sys._MEIPASS
    return os.path.dirname(os.path.abspath(__file__))


class ConsolidationGUI:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("Consolidation Pipeline")
        self.root.geometry("780x620")
        self.root.minsize(600, 500)

        self.selected_files: list[str] = []
        self.output_dir: str = ""
        self.running = False

        self._build_ui()
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

    def _build_ui(self):
        # --- File selection frame ---
        file_frame = tk.LabelFrame(self.root, text="Source Excel Files", padx=10, pady=5)
        file_frame.pack(fill=tk.BOTH, expand=True, padx=12, pady=(12, 6))

        btn_frame = tk.Frame(file_frame)
        btn_frame.pack(fill=tk.X, pady=(0, 5))

        tk.Button(btn_frame, text="Add Files...", command=self._add_files,
                  width=14).pack(side=tk.LEFT, padx=(0, 6))
        tk.Button(btn_frame, text="Remove Selected", command=self._remove_selected,
                  width=14).pack(side=tk.LEFT, padx=(0, 6))
        tk.Button(btn_frame, text="Clear All", command=self._clear_all,
                  width=10).pack(side=tk.LEFT)

        list_frame = tk.Frame(file_frame)
        list_frame.pack(fill=tk.BOTH, expand=True)

        scrollbar = tk.Scrollbar(list_frame)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)

        self.file_listbox = tk.Listbox(
            list_frame, selectmode=tk.EXTENDED,
            yscrollcommand=scrollbar.set, height=6
        )
        self.file_listbox.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        scrollbar.config(command=self.file_listbox.yview)

        # --- Output directory frame ---
        out_frame = tk.LabelFrame(self.root, text="Output Location", padx=10, pady=5)
        out_frame.pack(fill=tk.X, padx=12, pady=6)

        out_row = tk.Frame(out_frame)
        out_row.pack(fill=tk.X)

        self.output_path_var = tk.StringVar()
        tk.Entry(out_row, textvariable=self.output_path_var, state="readonly").pack(
            side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 6))
        tk.Button(out_row, text="Browse...", command=self._select_output_dir,
                  width=12).pack(side=tk.RIGHT)

        # --- Run button ---
        self.run_btn = tk.Button(
            self.root, text="Run Consolidation", command=self._run_pipeline,
            bg="#4CAF50", fg="white", font=("", 12, "bold"),
            height=2, cursor="hand2"
        )
        self.run_btn.pack(fill=tk.X, padx=12, pady=6)

        # --- Log area ---
        log_frame = tk.LabelFrame(self.root, text="Progress Log", padx=10, pady=5)
        log_frame.pack(fill=tk.BOTH, expand=True, padx=12, pady=(6, 12))

        self.log_area = scrolledtext.ScrolledText(
            log_frame, state="disabled", height=12,
            font=("Menlo", 10), wrap=tk.WORD
        )
        self.log_area.pack(fill=tk.BOTH, expand=True)

    def _log(self, msg: str):
        self.log_area.config(state="normal")
        self.log_area.insert(tk.END, msg + "\n")
        self.log_area.see(tk.END)
        self.log_area.config(state="disabled")
        self.root.update_idletasks()

    def _add_files(self):
        files = filedialog.askopenfilenames(
            title="Select Excel Files",
            filetypes=[("Excel files", "*.xlsx *.xls"), ("All files", "*.*")]
        )
        for f in files:
            if f not in self.selected_files:
                self.selected_files.append(f)
                self.file_listbox.insert(tk.END, os.path.basename(f))
        if self.selected_files:
            self._auto_set_output_dir()

    def _remove_selected(self):
        selected = self.file_listbox.curselection()
        for idx in reversed(selected):
            self.file_listbox.delete(idx)
            self.selected_files.pop(idx)

    def _clear_all(self):
        self.file_listbox.delete(0, tk.END)
        self.selected_files.clear()

    def _select_output_dir(self):
        d = filedialog.askdirectory(title="Select Output Folder")
        if d:
            self.output_dir = d
            self.output_path_var.set(d)

    def _auto_set_output_dir(self):
        if not self.output_dir and self.selected_files:
            first = os.path.dirname(self.selected_files[0])
            self.output_dir = first
            self.output_path_var.set(first)

    def _set_running(self, running: bool):
        self.running = running
        state = "disabled" if running else "normal"
        for child in self.root.winfo_children():
            for grandchild in child.winfo_children() if hasattr(child, 'winfo_children') else []:
                if isinstance(grandchild, tk.Button):
                    grandchild.config(state=state)
        self.run_btn.config(
            text="Running..." if running else "Run Consolidation",
            state="normal" if not running else "disabled",
            bg="#f44336" if running else "#4CAF50"
        )
        self.root.update_idletasks()

    def _on_close(self):
        if self.running:
            if not messagebox.askokcancel("Quit", "Pipeline is running. Exit anyway?"):
                return
        self.root.destroy()

    def _run_pipeline(self):
        if self.running:
            return
        if not self.selected_files:
            messagebox.showwarning("No Files", "Please add at least one Excel file.")
            return
        if not self.output_dir:
            messagebox.showwarning("No Output", "Please select an output folder.")
            return

        self._set_running(True)
        self.log_area.config(state="normal")
        self.log_area.delete(1.0, tk.END)
        self.log_area.config(state="disabled")

        thread = threading.Thread(target=self._run_async, daemon=True)
        thread.start()

    def _run_async(self):
        tmp_dir = None
        try:
            tmp_dir = tempfile.mkdtemp(prefix="consolidation_")
            self._log(f"✓ Preparing workspace...")

            # Copy config schemas to temp workspace
            config_src = os.path.join(resource_base(), "config", "schemas")
            if os.path.exists(config_src):
                config_dst = os.path.join(tmp_dir, "config", "schemas")
                os.makedirs(config_dst, exist_ok=True)
                for f in os.listdir(config_src):
                    shutil.copy2(os.path.join(config_src, f), os.path.join(config_dst, f))

            # Copy selected Excel files to temp workspace
            for f in self.selected_files:
                shutil.copy2(f, os.path.join(tmp_dir, os.path.basename(f)))
                self._log(f"  ✓ {os.path.basename(f)}")

            self._log(f"✓ Running consolidation pipeline...")
            self._log("")

            # Redirect stdout to capture pipeline output in real-time
            from io import StringIO

            class Tee:
                def __init__(self, log_fn, orig_stdout):
                    self.log_fn = log_fn
                    self.orig_stdout = orig_stdout
                    self.buf = ""

                def write(self, text):
                    self.buf += text
                    self.orig_stdout.write(text)
                    if text.endswith("\n") and self.buf.strip():
                        self.log_fn(self.buf.rstrip())
                        self.buf = ""

                def flush(self):
                    if self.buf.strip():
                        self.log_fn(self.buf.rstrip())
                    self.orig_stdout.flush()
                    self.buf = ""

            old_stdout = sys.stdout
            sys.stdout = Tee(self._log, old_stdout)

            try:
                sys.path.insert(0, resource_base())
                from src.main import execute_e2e_consolidation

                output_path = os.path.join(tmp_dir, OUTPUT_FILENAME)
                execute_e2e_consolidation(tmp_dir, output_path)
            finally:
                sys.stdout = old_stdout

            # Copy output to user's chosen directory
            dest = os.path.join(self.output_dir, OUTPUT_FILENAME)
            shutil.copy2(output_path, dest)
            self._log("")
            self._log(f"✓ Output saved to:")
            self._log(f"  {dest}")

            # Copy audit log
            for f in os.listdir(tmp_dir):
                if f.startswith("run_audit_log") and f.endswith(".json"):
                    shutil.copy2(os.path.join(tmp_dir, f), os.path.join(self.output_dir, f))
                    self._log(f"  ✓ {f}")
                    break

            self._log("")
            self._log("=" * 60)
            self._log("  DONE! Open the consolidated file in Excel.")
            self._log("=" * 60)

        except Exception as e:
            self._log("")
            self._log(f"ERROR: {e}")
            self._log("Please check your files and try again.")
        finally:
            if tmp_dir and os.path.exists(tmp_dir):
                shutil.rmtree(tmp_dir, ignore_errors=True)
            self.root.after(0, self._set_running, False)

    def run(self):
        self.root.mainloop()


if __name__ == "__main__":
    ConsolidationGUI().run()
