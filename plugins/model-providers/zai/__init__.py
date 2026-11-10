"""ZAI / GLM provider profile."""

from typing import Any

from providers import register_provider
from providers.base import ProviderProfile

# z.ai glm-5* models force thinking (thinking.type=disabled → HTTP 1210
# "please use low, high, or max"). The only latency knob is the TOP-LEVEL
# ``reasoning_effort`` string. Probe-verified 2026-10-30 against
# api.z.ai/api/paas/v4 glm-5.3-flash:
#   - top-level reasoning_effort=low  → 0 reasoning tokens, fastest visible token
#   - extra_body reasoning={effort:…} → IGNORED silently (still thought)
#   - effort acts as a ceiling: trivial tasks skip thinking even at high/max
_ZAI_EFFORT_MAP = {
    "minimal": "low",
    "low": "low",
    "medium": "high",
    "high": "high",
    "xhigh": "max",
    "max": "max",  # parity with DeepSeek: a raw "max" must not fall through
    # to the server default (probe: omitting the param ran to the token cap).
}


class ZaiProfile(ProviderProfile):
    """Z.AI / GLM — top-level reasoning_effort for forced-thinking glm-5* models.

    Hermes' default reasoning path (extra_body.reasoning) never fires for zai
    (run_agent._supports_reasoning_extra_body gates it off) and z.ai would
    ignore that shape anyway. This hook emits the shape z.ai actually honors:
    a top-level ``reasoning_effort`` string, same mechanism as Kimi.
    """

    def build_api_kwargs_extras(
        self,
        *,
        reasoning_config: dict | None = None,
        model: str | None = None,
        base_url: str | None = None,
        **context: Any,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        if not base_url or "api.z.ai" not in str(base_url):
            return {}, {}
        if not model or not str(model).lower().startswith("glm-5"):
            return {}, {}  # older/aux models keep provider defaults

        if isinstance(reasoning_config, dict) and reasoning_config.get("enabled") is False:
            # Cannot disable on glm-5* — send the floor instead of erroring.
            return {}, {"reasoning_effort": "low"}

        if reasoning_config is None:
            return {}, {}  # no explicit config → z.ai server default

        requested = str(reasoning_config.get("effort", "") or "").strip().lower()
        effort = _ZAI_EFFORT_MAP.get(requested)
        if effort is None:
            return {}, {}
        return {}, {"reasoning_effort": effort}


zai = ZaiProfile(
    name="zai",
    aliases=("glm", "z-ai", "z.ai", "zhipu"),
    env_vars=("GLM_API_KEY", "ZAI_API_KEY", "Z_AI_API_KEY"),
    display_name="Z.AI (GLM)",
    description="Z.AI / GLM — Zhipu AI models",
    signup_url="https://z.ai/",
    fallback_models=(
        "glm-5.2",
        "glm-5.1",
        "glm-5",
    ),
    base_url="https://api.z.ai/api/paas/v4",
    default_aux_model="glm-5-turbo",
)

register_provider(zai)
