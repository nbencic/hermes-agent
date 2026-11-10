"""DeepSeek provider profile.

DeepSeek's V4 family (and the legacy ``deepseek-reasoner``) defaults to
thinking-mode ON when ``extra_body.thinking`` is unset.  The API then returns
``reasoning_content`` and starts enforcing the contract that subsequent turns
echo it back; combined with how Hermes replays history this lands on the
notorious HTTP 400 ``reasoning_content must be passed back`` error after the
first tool call (#15700, #17212, #17825).

This profile overrides :meth:`build_api_kwargs_extras` to mirror the Kimi /
Moonshot wire shape that DeepSeek's OpenAI-compat endpoint expects:

    {"reasoning_effort": "<low|medium|high|max>",
     "extra_body": {"thinking": {"type": "enabled" | "disabled"}}}

Legacy identifiers ``deepseek-chat`` (V3) and ``deepseek-reasoner`` (R1) were
retired when the API moved to V4 (verified 2026-11: ``GET /v1/models`` returns
only ``deepseek-flash`` and ``deepseek-v4-pro``).  ``deepseek-flash`` (V4.1-Flash)
is thinking-capable; legacy names are still normalized for old configs.
"""

from __future__ import annotations

from typing import Any

from providers import register_provider
from providers.base import ProviderProfile


def _model_supports_thinking(model: str | None) -> bool:
    """DeepSeek thinking-capable model families.

    Covers the V4 family (``deepseek-v4-pro``, ``deepseek-v4-flash``, and any
    future ``deepseek-v<N>-*`` variants), ``deepseek-flash`` (V4.1-Flash and
    dated variants), and the legacy ``deepseek-reasoner`` (R1).
    ``deepseek-chat`` was V3 with no thinking mode (now retired).
    """
    m = (model or "").strip().lower()
    if not m:
        return False
    if m.startswith("deepseek-v") and not m.startswith("deepseek-v3"):
        # deepseek-v4-*, deepseek-v5-*, etc. — every V4+ generation has
        # thinking. v3 explicitly excluded.
        return True
    if m == "deepseek-reasoner" or m.startswith("deepseek-flash"):
        return True
    return False


class DeepSeekProfile(ProviderProfile):
    """DeepSeek — extra_body.thinking + top-level reasoning_effort."""

    def build_api_kwargs_extras(
        self, *, reasoning_config: dict | None = None, model: str | None = None, **context
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        extra_body: dict[str, Any] = {}
        top_level: dict[str, Any] = {}

        if not _model_supports_thinking(model):
            # V3 / unknown — leave wire format untouched, current behavior.
            return extra_body, top_level

        # Determine enabled/disabled.  Default is enabled to match DeepSeek's
        # API default; the API requires this to be set explicitly to avoid the
        # reasoning_content echo trap on subsequent turns.
        enabled = True
        if isinstance(reasoning_config, dict) and reasoning_config.get("enabled") is False:
            enabled = False

        extra_body["thinking"] = {"type": "enabled" if enabled else "disabled"}

        if not enabled:
            return extra_body, top_level

        # Effective-level mapping per DeepSeek's official table
        # (api-docs.deepseek.com/guides/thinking_mode):
        #   minimal -> low, low -> low, medium -> high, high -> high,
        #   xhigh -> high (if sent verbatim), max -> max, ultra -> max.
        # Hermes sends explicit values, so: "none" disables thinking (true Off),
        # "minimal" is sent as "low", and xhigh maps to "max" so the UI's
        # "Max" pill can actually reach DeepSeek's max tier. Everything else
        # passes through and the server applies its own coercion.
        if isinstance(reasoning_config, dict):
            effort = (reasoning_config.get("effort") or "").strip().lower()
            if effort == "none":
                # "none" = thinking off. Toggle the wire flag rather than
                # merely omitting reasoning_effort (omitting leaves the server
                # default high, which is the current silent-mismatch bug).
                extra_body["thinking"] = {"type": "disabled"}
                return extra_body, top_level
            if effort in {"xhigh", "max"}:
                top_level["reasoning_effort"] = "max"
            elif effort == "minimal":
                top_level["reasoning_effort"] = "low"
            elif effort in {"low", "medium", "high"}:
                top_level["reasoning_effort"] = effort

        return extra_body, top_level


deepseek = DeepSeekProfile(
    name="deepseek",
    aliases=("deepseek-chat",),
    env_vars=("DEEPSEEK_API_KEY",),
    display_name="DeepSeek",
    description="DeepSeek — native DeepSeek API",
    signup_url="https://platform.deepseek.com/",
    fallback_models=(
        "deepseek-flash",
        "deepseek-v4-pro",
    ),
    base_url="https://api.deepseek.com/v1",
    default_aux_model="deepseek-flash",
)

register_provider(deepseek)
