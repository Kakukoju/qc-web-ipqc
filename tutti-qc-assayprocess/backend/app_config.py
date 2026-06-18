"""Shared application paths without importing the FastAPI app."""

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

SPEC_DB_PATH = Path(os.getenv("SPEC_DB_PATH", "/home/ubuntu/bead_ipqc_spec.db"))
