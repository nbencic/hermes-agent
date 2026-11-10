"""Unit tests for the Z.AI / GLM provider profile's effort wiring.

GLM-5* models cannot disable thinking (HTTP 1210 "This model always engages in
thinking and cannot be disabled; please use low, high, or max"). The only knob
is the TOP-LEVEL ``reasoning_effort`` string; ``extra_body.reasoning`` is
silently ignored by z.ai.

Wire contract pinned here (probe-verified 2026-11 against
api.z.ai/api/paas/v4, glm-5.3-flashx):
  minimal -> low, low -> low, medium -> high, high -> high, xhigh -> max,
  max -> max, and enabled=False degrades to the "low" floor instead of the
  HTTP 1210 error. Non-glm-5 models and non-z.ai base URLs are untouched.
"""

from __future__ import annotations

import pytest


@pytest.fixture
def zai_profile():
    """Resolve the registered Z.AI profile end-to-end."""
    import model_tools  # noqa: F401  (triggers plugin discovery)

    import providers

    profile = providers.get_provider_profile("zai")
    assert profile is not None, "zai provider profile must be registered"
    return profile


ZAI_BASE = "https://api.z.ai/api/paas/v4"


class TestZaiEffortWireShape:
    def test_minimal_maps_to_low(self, zai_profile):
        _, top = zai_profile.build_api_kwargs_extras(
            reasoning_config={"enabled": True, "effort": "minimal"},
            model="glm-5.3-flashx", base_url=ZAI_BASE,
        )
        assert top == {"reasoning_effort": "low"}

    def test_medium_maps_to_high(self, zai_profile):
        _, top = zai_profile.build_api_kwargs_extras(
            reasoning_config={"enabled": True, "effort": "medium"},
            model="glm-5.3-flashx", base_url=ZAI_BASE,
        )
        assert top == {"reasoning_effort": "high"}

    @pytest.mark.parametrize("effort", ["xhigh", "max", "MAX", "  Max  "])
    def test_xhigh_and_max_normalize_to_max(self, zai_profile, effort):
        """A raw 'max' must not fall through to the server default."""
        _, top = zai_profile.build_api_kwargs_extras(
            reasoning_config={"enabled": True, "effort": effort},
            model="glm-5.3-flashx", base_url=ZAI_BASE,
        )
        assert top == {"reasoning_effort": "max"}

    def test_disabled_thinking_degrades_to_low_floor(self, zai_profile):
        """Disabled thinking is impossible on glm-5* (HTTP 1210) — send the
        low floor instead of erroring or silently ignoring the toggle."""
        extra, top = zai_profile.build_api_kwargs_extras(
            reasoning_config={"enabled": False},
            model="glm-5.3-flashx", base_url=ZAI_BASE,
        )
        assert extra == {}
        assert top == {"reasoning_effort": "low"}

    def test_non_glm5_models_untouched(self, zai_profile):
        extra, top = zai_profile.build_api_kwargs_extras(
            reasoning_config={"enabled": True, "effort": "high"},
            model="glm-4.7", base_url=ZAI_BASE,
        )
        assert extra == {} and top == {}

    def test_other_base_urls_untouched(self, zai_profile):
        extra, top = zai_profile.build_api_kwargs_extras(
            reasoning_config={"enabled": True, "effort": "high"},
            model="glm-5.3-flashx", base_url="https://api.openai.com/v1",
        )
        assert extra == {} and top == {}
