"""OpenAPI 工具工厂：把 OpenAPI/Swagger 文档自动转换为 penguin toolsBuiltin 工具定义。

概念（评审参考 agency-swarm ToolFactory）：任何发布 OpenAPI 文档的 HTTP API
（Amazon SP-API / TikTok Shop API / SearXNG 等）都能被自动转成 agent 可调用工具。
每个 operation（path + method）→ 一个 tool：name/description/parameters。

输出直接对接 gateway /api/agents/{id}/config 的 tools_builtin 整表替换契约。
"""

from __future__ import annotations

import json
import re
from typing import Optional

import httpx


class OpenAPIFactoryError(RuntimeError):
    """OpenAPI 解析失败。"""


def _normalize_name(operation_id: str, method: str, path: str) -> str:
    """工具名：优先 operationId，回退 method+path 精简；仅保留小写字母数字下划线。"""
    name = operation_id or f"{method}_{path}"
    name = re.sub(r"[^a-zA-Z0-9_]", "_", name).lower()
    name = re.sub(r"_+", "_", name).strip("_")
    if not name:
        name = "api_tool"
    return name[:60]


def _resolve_ref(ref: str, components: dict) -> dict:
    """解析 $ref（#/components/schemas/X）。"""
    if not ref or not ref.startswith("#/components/"):
        return {}
    parts = ref.split("/")[1:]  # ['components','schemas','X']
    cur = components
    for p in parts:
        cur = cur.get(p, {}) if isinstance(cur, dict) else {}
    return cur or {}


def _simplify_schema(schema: dict, components: dict, depth: int = 0) -> dict:
    """把 JSON Schema 精简为工具参数（object → {type, properties, required}）。"""
    if depth > 3:
        return {"type": "string"}
    if "$ref" in schema:
        return _simplify_schema(_resolve_ref(schema["$ref"], components), components, depth)
    schema_type = schema.get("type", "string")
    out: dict = {"type": schema_type}
    if schema_type == "object":
        props = {}
        for k, v in (schema.get("properties") or {}).items():
            props[k] = _simplify_schema(v, components, depth + 1)
        out["properties"] = props
        if schema.get("required"):
            out["required"] = schema["required"]
    elif schema_type == "array":
        out["items"] = _simplify_schema(schema.get("items", {}), components, depth + 1)
    return out


def _extract_parameters(path_item: dict, operation: dict, components: dict) -> dict:
    """聚合 operation + path_item 的 parameters（path/query/header）为对象 schema。"""
    props, required = {}, []
    # 参数可在 operation 级或 path_item 级（OpenAPI 3.x），二者都取
    for p in (list(path_item.get("parameters", [])) + list(operation.get("parameters", []))):
        if "$ref" in p:
            p = _resolve_ref(p["$ref"], components)
        name = p.get("name") or ""
        if not name:
            continue
        props[name] = _simplify_schema(p.get("schema", {"type": "string"}), components)
        if p.get("required"):
            required.append(name)
    return {"type": "object", "properties": props, "required": required}


def _json_schema_params(schema: dict, components: dict) -> dict:
    """requestBody 的 schema → 参数（作为单一 body 参数）。"""
    return _simplify_schema(schema, components)


def parse_openapi_doc(doc: dict) -> list[dict]:
    """解析 OpenAPI 3.x / Swagger 2.0 文档，返回 toolsBuiltin 工具定义列表。"""
    if not isinstance(doc, dict) or not doc.get("paths"):
        raise OpenAPIFactoryError("文档缺少 paths（不是有效 OpenAPI/Swagger）")

    components = doc.get("components") or doc.get("definitions") or {}
    tools = []

    for path, path_item in (doc.get("paths") or {}).items():
        if not isinstance(path_item, dict):
            continue
        for method in ("get", "post", "put", "patch", "delete"):
            op = path_item.get(method)
            if not isinstance(op, dict):
                continue
            operation_id = op.get("operationId", "")
            summary = op.get("summary") or op.get("description") or f"{method.upper()} {path}"
            name = _normalize_name(operation_id, method, path)

            # 参数：路径/查询 + 请求体
            params = _extract_parameters(path_item, op, components)
            request_body = op.get("requestBody")
            if request_body and isinstance(request_body, dict):
                content = request_body.get("content") or {}
                for media, body_schema in content.items():
                    if isinstance(body_schema, dict) and body_schema.get("schema"):
                        body_params = _json_schema_params(body_schema["schema"], components)
                        params["properties"]["body"] = body_params
                        if "required" not in params:
                            params["required"] = []
                        if request_body.get("required"):
                            params["required"].append("body")

            tools.append({
                "name": name,
                "description": f"{summary[:200]} [via {method.upper()} {path}]",
                "parameters": params,
                "permission": "rw",
            })

    if not tools:
        raise OpenAPIFactoryError("文档中没有可生成的 operation")
    return tools


async def fetch_openapi(url: str) -> dict:
    """从 URL 拉取 OpenAPI 文档（SSRF 防护：仅允许公网域名 + 禁私网）。"""
    from routes.settings import _validate_test_url
    _validate_test_url(url)
    async with httpx.AsyncClient(trust_env=False, timeout=20) as client:
        resp = await client.get(url, headers={"Accept": "application/json, application/yaml"})
    if resp.status_code >= 400:
        raise OpenAPIFactoryError(f"HTTP {resp.status_code}: {resp.text[:200]}")
    try:
        return json.loads(resp.text)
    except json.JSONDecodeError:
        try:
            import yaml
            return yaml.safe_load(resp.text)
        except Exception as exc:
            raise OpenAPIFactoryError(f"文档不是有效 JSON/YAML: {exc}")
