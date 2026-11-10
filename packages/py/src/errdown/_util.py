"""Helpers that reproduce JavaScript semantics so output matches the TypeScript reference exactly."""
from __future__ import annotations

import json
import math
from typing import Any


def is_num(v: Any) -> bool:
    """JS `typeof v === "number"` (bool is not a number)."""
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def js_num(v: Any) -> Any:
    """Integral floats become ints (JS has one number type: 1.0 prints as 1)."""
    if isinstance(v, float) and v.is_integer() and math.isfinite(v):
        return int(v)
    return v


def js_str(v: Any) -> str:
    """JS String(v) for numbers, booleans and strings."""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float):
        if v.is_integer() and math.isfinite(v):
            return str(int(v))
        r = repr(v)
        return r
    return str(v)


def js_round(x: float) -> int:
    """JS Math.round: halves round toward +infinity."""
    return int(math.floor(x + 0.5))


def _plain(v: Any) -> Any:
    if isinstance(v, dict):
        return {k: _plain(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_plain(x) for x in v]
    return js_num(v)


def js_stringify(v: Any, indent: Any = None) -> str:
    """JSON.stringify: compact separators, no ASCII escaping, integral floats as ints."""
    if indent:
        return json.dumps(_plain(v), ensure_ascii=False, indent=indent)
    return json.dumps(_plain(v), ensure_ascii=False, separators=(",", ":"))


def _reject_constant(name: str) -> Any:
    raise ValueError(name)


def js_parse(s: str) -> Any:
    """JSON.parse: rejects NaN/Infinity, which Python's json accepts."""
    return json.loads(s, parse_constant=_reject_constant)


def js_trim(s: str) -> str:
    # JS trim() strips whitespace + line terminators incl. U+FEFF; Python strip() lacks U+FEFF.
    return s.strip().strip("﻿").strip()
