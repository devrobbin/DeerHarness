"""pytest 环境：先注入必需环境变量，再导入 gateway 模块。"""

import os
import sys

# config.py 在导入时校验必填环境变量（评审 A：fail-fast）
os.environ.setdefault("PENGUIN_API", "http://penguin.test:7368")
os.environ.setdefault("PENGUIN_USER_ID", "admin")
os.environ.setdefault("PENGUIN_PASSWORD", "test-penguin-pass")
os.environ.setdefault("DEERFLOW_API", "http://deerflow.test:2026")
os.environ.setdefault("DEERFLOW_EMAIL", "admin@test.local")
os.environ.setdefault("DEERFLOW_PASSWORD", "test-deerflow-pass")
os.environ.setdefault("ADMIN_API_KEY", "test-admin-key")

sys.path.insert(0, os.path.dirname(__file__))  # gateway/ 加入 path
