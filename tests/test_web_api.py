import os
import shutil
import pytest
from fastapi.testclient import TestClient
from src.web_api import app

@pytest.fixture
def api_client():
    return TestClient(app)

def test_api_consolidation_e2e(api_client, test_workspace, mock_axis_tracker, mock_rbl_tracker):
    """
    Integration test verifying that dragging/uploading Excel files to the web endpoint 
    successfully triggers the consolidation pipeline, records correct execution logs, 
    and returns a downloadable file ID.
    """
    # 1. Copy config schemas into the active test_workspace config folder
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    config_src = os.path.join(base_dir, "config", "schemas")
    config_dst = os.path.join(test_workspace, "config", "schemas")
    os.makedirs(config_dst, exist_ok=True)
    if os.path.exists(config_src):
        for f in os.listdir(config_src):
            shutil.copy2(os.path.join(config_src, f), os.path.join(config_dst, f))

    # Mock python file uploads
    with open(mock_axis_tracker, "rb") as axis_file, open(mock_rbl_tracker, "rb") as rbl_file:
        files = [
            ("files", (os.path.basename(mock_axis_tracker), axis_file, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")),
            ("files", (os.path.basename(mock_rbl_tracker), rbl_file, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
        ]
        
        # Trigger POST /api/consolidate
        response = api_client.post("/api/consolidate", files=files)
        
    assert response.status_code == 200
    res_data = response.json()
    assert res_data["success"] is True
    assert "logs" in res_data
    assert "file_id" in res_data
    assert "audit_log" in res_data
    
    # Verify log capture works
    assert "Running consolidation pipeline" in res_data["logs"]
    assert "Discovering client schemas" in res_data["logs"]

    # Verify run audit log content
    audit = res_data["audit_log"]
    assert "reconciliation_status" in audit
    assert len(audit["files_processed"]) == 2

    # 2. Verify file download endpoint
    file_id = res_data["file_id"]
    download_res = api_client.get(f"/api/download/{file_id}")
    assert download_res.status_code == 200
    assert download_res.headers["content-type"] == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    assert len(download_res.content) > 1000  # Should be a non-trivial Excel workbook binary

def test_api_download_not_found(api_client):
    """Verify that requesting an expired or invalid file ID yields a proper 404 response."""
    response = api_client.get("/api/download/non-existent-uuid")
    assert response.status_code == 404
