import os

# src.config refuses to import without one of the two auth settings; the tests never serve.
os.environ.setdefault("INFERENCE_ALLOW_NO_AUTH", "true")
