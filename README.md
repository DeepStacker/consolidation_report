---
title: Excel Consolidation Pipeline
emoji: 📊
colorFrom: blue
colorTo: indigo
sdk: docker
pinned: false
---

# Excel Consolidation Pipeline Web Hub

A dynamic, schema-driven multi-client spreadsheet consolidation application. This web platform automates cell-level mapping, strict data validation, custom fee calculations, and formats high-fidelity output reports dynamically for multiple banking formats.

### Local Execution
To run both the React frontend and the FastAPI backend locally:
```bash
./run_web.sh
```

### Production Deployment
This repository is configured to be hosted for free on **Hugging Face Spaces** using Docker:
* Exposes Port: `7860`
* SDK: `docker` (Blank template)
* Build Configuration: Defined in the [Dockerfile](file:///Users/deepstacker/Downloads/consolidation_report/Dockerfile).

Check out the configuration reference at https://huggingface.co/docs/hub/spaces-config-reference
