import os
import shutil
import tempfile
import uuid
import sys
from io import StringIO
from typing import List, Dict, Any
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from src.main import execute_e2e_consolidation

app = FastAPI(title="Consolidation Pipeline API")

# Enable CORS for frontend development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
frontend_dist = os.path.join(base_dir, "frontend", "dist")


# In-memory storage for temporary generated files (keyed by session UUID)
# In production, this would use a cleaner temp directory structure
GENERATED_FILES: Dict[str, str] = {}
AUDIT_LOGS: Dict[str, Dict[str, Any]] = {}

class LogCapture:
    def __init__(self):
        self.stream = StringIO()
        self.orig_stdout = sys.stdout

    def __enter__(self):
        sys.stdout = self.stream
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        sys.stdout = self.orig_stdout

    def get_logs(self) -> str:
        return self.stream.getvalue()

@app.post("/api/consolidate")
async def consolidate(files: List[UploadFile] = File(...)):
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded")

    # Create a temporary workspace directory
    tmp_dir = tempfile.mkdtemp(prefix="web_consolidation_")
    try:
        # Copy global config schemas to the temp workspace
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        config_src = os.path.join(base_dir, "config", "schemas")
        if os.path.exists(config_src):
            config_dst = os.path.join(tmp_dir, "config", "schemas")
            os.makedirs(config_dst, exist_ok=True)
            for f in os.listdir(config_src):
                shutil.copy2(os.path.join(config_src, f), os.path.join(config_dst, f))

        # Write uploaded files to temp workspace
        uploaded_files_log = []
        for file in files:
            file_path = os.path.join(tmp_dir, file.filename)
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
            uploaded_files_log.append(file.filename)

        output_path = os.path.join(tmp_dir, "Consolidated_Report.xlsx")
        
        # Execute the pipeline while capturing standard output
        with LogCapture() as capturer:
            print("✓ Preparing workspace...")
            for f in uploaded_files_log:
                print(f"  ✓ {f}")
            print("✓ Running consolidation pipeline...\n")
            
            try:
                execute_e2e_consolidation(tmp_dir, output_path)
                success = True
                error_msg = None
            except Exception as e:
                success = False
                error_msg = str(e)
                print(f"\nERROR: {e}")

        logs = capturer.get_logs()

        if not success:
            return {
                "success": False,
                "logs": logs,
                "error": error_msg
            }

        # Keep output file in memory for retrieval
        file_id = str(uuid.uuid4())
        perm_temp_path = os.path.join(tempfile.gettempdir(), f"consolidated_{file_id}.xlsx")
        shutil.copy2(output_path, perm_temp_path)
        GENERATED_FILES[file_id] = perm_temp_path

        # Find and load the generated run audit log
        audit_data = {}
        for f in os.listdir(tmp_dir):
            if f.startswith("run_audit_log") and f.endswith(".json"):
                import json
                with open(os.path.join(tmp_dir, f), "r") as log_file:
                    audit_data = json.load(log_file)
                break

        return {
            "success": True,
            "logs": logs,
            "file_id": file_id,
            "audit_log": audit_data
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Pipeline error: {str(e)}")
    finally:
        if os.path.exists(tmp_dir):
            shutil.rmtree(tmp_dir, ignore_errors=True)

@app.get("/api/download/{file_id}")
async def download_file(file_id: str):
    file_path = GENERATED_FILES.get(file_id)
    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found or expired")
    
    return FileResponse(
        path=file_path,
        filename="Consolidated_Report.xlsx",
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )

# Mount static files for the React frontend when built
if os.path.exists(frontend_dist):
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("src.web_api:app", host="0.0.0.0", port=8000, reload=True)

