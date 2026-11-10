from datetime import datetime, timezone
from types import SimpleNamespace

from agent.usage_pricing import (
    CanonicalUsage,
    estimate_usage_cost,
    get_pricing_entry,
    is_off_peak,
    normalize_usage,
)

# Fixed instants so time-of-day pricing can't make tests flake.
# 2026-11-10 is a Tuesday; 2026-11-07 is a Saturday.
DEEPSEEK_PEAK = datetime(2026, 11, 10, 2, 30, tzinfo=timezone.utc)     # 02:30 UTC Tue
DEEPSEEK_OFFPEAK = datetime(2026, 11, 10, 12, 0, tzinfo=timezone.utc)  # 12:00 UTC Tue
DEEPSEEK_WEEKEND = datetime(2026, 11, 7, 2, 30, tzinfo=timezone.utc)   # 02:30 UTC Sat


def test_normalize_usage_anthropic_keeps_cache_buckets_separate():
    usage = SimpleNamespace(
        input_tokens=1000,
        output_tokens=500,
        cache_read_input_tokens=2000,
        cache_creation_input_tokens=400,
    )

    normalized = normalize_usage(usage, provider="anthropic", api_mode="anthropic_messages")

    assert normalized.input_tokens == 1000
    assert normalized.output_tokens == 500
    assert normalized.cache_read_tokens == 2000
    assert normalized.cache_write_tokens == 400
    assert normalized.prompt_tokens == 3400


def test_normalize_usage_openai_subtracts_cached_prompt_tokens():
    usage = SimpleNamespace(
        prompt_tokens=3000,
        completion_tokens=700,
        prompt_tokens_details=SimpleNamespace(cached_tokens=1800),
    )

    normalized = normalize_usage(usage, provider="openai", api_mode="chat_completions")

    assert normalized.input_tokens == 1200
    assert normalized.cache_read_tokens == 1800
    assert normalized.output_tokens == 700


def test_normalize_usage_openai_reads_top_level_anthropic_cache_fields():
    """Some OpenAI-compatible proxies (OpenRouter, Cline) expose
    Anthropic-style cache token counts at the top level of the usage object when
    routing Claude models, instead of nesting them in prompt_tokens_details.

    Regression guard for the bug fixed in cline/cline#10266 — before this fix,
    the chat-completions branch of normalize_usage() only read
    prompt_tokens_details.cache_write_tokens and completely missed the
    cache_creation_input_tokens case, so cache writes showed as 0 and reflected
    inputTokens were overstated by the cache-write amount.
    """
    usage = SimpleNamespace(
        prompt_tokens=1000,
        completion_tokens=200,
        prompt_tokens_details=SimpleNamespace(cached_tokens=500),
        cache_creation_input_tokens=300,
    )

    normalized = normalize_usage(usage, provider="openrouter", api_mode="chat_completions")

    # Expected: cache read from prompt_tokens_details.cached_tokens (preferred),
    # cache write from top-level cache_creation_input_tokens (fallback).
    assert normalized.cache_read_tokens == 500
    assert normalized.cache_write_tokens == 300
    # input_tokens = prompt_total - cache_read - cache_write = 1000 - 500 - 300 = 200
    assert normalized.input_tokens == 200
    assert normalized.output_tokens == 200


def test_normalize_usage_openai_reads_top_level_cache_read_when_details_missing():
    """Some proxies expose only top-level Anthropic-style fields with no
    prompt_tokens_details object. Regression guard for cline/cline#10266.
    """
    usage = SimpleNamespace(
        prompt_tokens=1000,
        completion_tokens=200,
        cache_read_input_tokens=500,
        cache_creation_input_tokens=300,
    )

    normalized = normalize_usage(usage, provider="openrouter", api_mode="chat_completions")

    assert normalized.cache_read_tokens == 500
    assert normalized.cache_write_tokens == 300
    assert normalized.input_tokens == 200


def test_normalize_usage_openai_prefers_prompt_tokens_details_over_top_level():
    """When both prompt_tokens_details and top-level Anthropic fields are
    present, we prefer the OpenAI-standard nested fields. Top-level Anthropic
    fields are only a fallback when the nested ones are absent/zero.
    """
    usage = SimpleNamespace(
        prompt_tokens=1000,
        completion_tokens=200,
        prompt_tokens_details=SimpleNamespace(cached_tokens=600, cache_write_tokens=150),
        # Intentionally different values — proving we ignore these when details exist.
        cache_read_input_tokens=999,
        cache_creation_input_tokens=999,
    )

    normalized = normalize_usage(usage, provider="openrouter", api_mode="chat_completions")

    assert normalized.cache_read_tokens == 600
    assert normalized.cache_write_tokens == 150


def test_openrouter_models_api_pricing_is_converted_from_per_token_to_per_million(monkeypatch):
    monkeypatch.setattr(
        "agent.usage_pricing.fetch_model_metadata",
        lambda: {
            "anthropic/claude-opus-4.6": {
                "pricing": {
                    "prompt": "0.000005",
                    "completion": "0.000025",
                    "input_cache_read": "0.0000005",
                    "input_cache_write": "0.00000625",
                }
            }
        },
    )

    entry = get_pricing_entry(
        "anthropic/claude-opus-4.6",
        provider="openrouter",
        base_url="https://openrouter.ai/api/v1",
    )

    assert float(entry.input_cost_per_million) == 5.0
    assert float(entry.output_cost_per_million) == 25.0
    assert float(entry.cache_read_cost_per_million) == 0.5
    assert float(entry.cache_write_cost_per_million) == 6.25


def test_estimate_usage_cost_marks_subscription_routes_included():
    result = estimate_usage_cost(
        "gpt-5.3-codex",
        CanonicalUsage(input_tokens=1000, output_tokens=500),
        provider="openai-codex",
        base_url="https://chatgpt.com/backend-api/codex",
    )

    assert result.status == "included"
    assert float(result.amount_usd) == 0.0


def test_estimate_usage_cost_refuses_cache_pricing_without_official_cache_rate(monkeypatch):
    monkeypatch.setattr(
        "agent.usage_pricing.fetch_model_metadata",
        lambda: {
            "google/gemini-2.5-pro": {
                "pricing": {
                    "prompt": "0.00000125",
                    "completion": "0.00001",
                }
            }
        },
    )

    result = estimate_usage_cost(
        "google/gemini-2.5-pro",
        CanonicalUsage(input_tokens=1000, output_tokens=500, cache_read_tokens=100),
        provider="openrouter",
        base_url="https://openrouter.ai/api/v1",
    )

    assert result.status == "unknown"


def test_custom_endpoint_models_api_pricing_is_supported(monkeypatch):
    monkeypatch.setattr(
        "agent.usage_pricing.fetch_endpoint_model_metadata",
        lambda base_url, api_key=None: {
            "zai-org/GLM-5-TEE": {
                "pricing": {
                    "prompt": "0.0000005",
                    "completion": "0.000002",
                }
            }
        },
    )

    entry = get_pricing_entry(
        "zai-org/GLM-5-TEE",
        provider="custom",
        base_url="https://llm.chutes.ai/v1",
        api_key="test-key",
    )

    assert float(entry.input_cost_per_million) == 0.5
    assert float(entry.output_cost_per_million) == 2.0


def test_nous_portal_pricing_preserves_vendor_prefixed_model_ids(monkeypatch):
    seen = {}

    def _fake_fetch_endpoint_model_metadata(base_url, api_key=None):
        seen["base_url"] = base_url
        return {
            "openai/gpt-5.5-pro": {
                "pricing": {
                    "prompt": "0.000025",
                    "completion": "0.000125",
                }
            }
        }

    monkeypatch.setattr(
        "agent.usage_pricing.fetch_endpoint_model_metadata",
        _fake_fetch_endpoint_model_metadata,
    )

    entry = get_pricing_entry("openai/gpt-5.5-pro", provider="nous")

    assert seen["base_url"] == "https://inference-api.nousresearch.com/v1"
    assert float(entry.input_cost_per_million) == 25.0
    assert float(entry.output_cost_per_million) == 125.0


def test_deepseek_v4_pro_pricing_entry_exists():
    """Regression test: deepseek-v4-pro must have a pricing entry.

    Before this fix, deepseek-v4-pro sessions showed as unknown cost
    in hermes insights because the _OFFICIAL_DOCS_PRICING table had no
    entry for that model.  See #24218.
    """
    entry = get_pricing_entry(
        "deepseek-v4-pro",
        provider="deepseek",
    )

    assert entry is not None
    assert entry.input_cost_per_million is not None
    assert entry.output_cost_per_million is not None
    assert entry.cache_read_cost_per_million is not None
    assert float(entry.input_cost_per_million) == 1.32
    assert float(entry.output_cost_per_million) == 3.96
    assert float(entry.cache_read_cost_per_million) == 0.044


def test_deepseek_v4_pro_estimate_usage_cost():
    """Ensure deepseek-v4-pro sessions get a dollar estimate, not unknown."""
    result = estimate_usage_cost(
        "deepseek-v4-pro",
        CanonicalUsage(input_tokens=1000000, output_tokens=500000),
        provider="deepseek",
        at=DEEPSEEK_PEAK,
    )

    assert result.status == "estimated"
    assert result.amount_usd is not None
    # 1M input × $1.32/M + 500K output × $3.96/M = $1.32 + $1.98 = $3.30
    assert float(result.amount_usd) == 3.30


def test_deepseek_flash_cache_reads_are_priced_not_unknown():
    """Regression: cache_read had no price, so ~98.6%-cached sessions priced as
    'unknown' and rendered $0.00 in insights and the desktop chrome."""
    result = estimate_usage_cost(
        "deepseek-flash",
        CanonicalUsage(input_tokens=2_000, cache_read_tokens=170_000, output_tokens=900),
        provider="deepseek",
        at=DEEPSEEK_PEAK,
    )

    assert result.status == "estimated"
    assert result.amount_usd is not None
    # 2k×$0.30 + 170k×$0.006 + 900×$1.20, all per 1M
    expected = (2000 * 0.30 + 170_000 * 0.006 + 900 * 1.20) / 1_000_000
    assert abs(float(result.amount_usd) - expected) < 1e-9


def test_deepseek_off_peak_is_exactly_half_of_peak():
    usage = CanonicalUsage(input_tokens=100_000, cache_read_tokens=900_000, output_tokens=50_000)
    peak = estimate_usage_cost("deepseek-flash", usage, provider="deepseek", at=DEEPSEEK_PEAK)
    off = estimate_usage_cost("deepseek-flash", usage, provider="deepseek", at=DEEPSEEK_OFFPEAK)

    assert peak.amount_usd is not None and off.amount_usd is not None
    assert float(peak.amount_usd) == float(off.amount_usd) * 2
    assert "Off-peak rate applied (50% of peak list price)." in off.notes
    assert "Off-peak rate applied (50% of peak list price)." not in peak.notes


def test_deepseek_weekend_is_off_peak_even_inside_peak_hours():
    usage = CanonicalUsage(input_tokens=1_000_000)
    peak = estimate_usage_cost("deepseek-flash", usage, provider="deepseek", at=DEEPSEEK_PEAK)
    weekend = estimate_usage_cost("deepseek-flash", usage, provider="deepseek", at=DEEPSEEK_WEEKEND)

    assert weekend.amount_usd is not None and peak.amount_usd is not None
    assert float(weekend.amount_usd) == float(peak.amount_usd) / 2
    assert is_off_peak("deepseek", DEEPSEEK_WEEKEND) is True
    assert is_off_peak("deepseek", DEEPSEEK_PEAK) is False
    # Same clock hour, different weekday → the week is what flips it.
    assert is_off_peak("deepseek", datetime(2026, 11, 9, 2, 30, tzinfo=timezone.utc)) is False


def test_off_peak_window_boundaries_for_deepseek():
    utc = timezone.utc
    assert is_off_peak("deepseek", datetime(2026, 11, 10, 0, 59, tzinfo=utc)) is True   # before peak 1
    assert is_off_peak("deepseek", datetime(2026, 11, 10, 1, 0, tzinfo=utc)) is False   # peak 1 starts
    assert is_off_peak("deepseek", datetime(2026, 11, 10, 3, 59, tzinfo=utc)) is False  # still peak 1
    assert is_off_peak("deepseek", datetime(2026, 11, 10, 4, 0, tzinfo=utc)) is True    # gap
    assert is_off_peak("deepseek", datetime(2026, 11, 10, 6, 0, tzinfo=utc)) is False   # peak 2 starts
    assert is_off_peak("deepseek", datetime(2026, 11, 10, 10, 0, tzinfo=utc)) is True   # peak 2 ends
    # Other schedules are unaffected.
    assert is_off_peak(None, DEEPSEEK_PEAK) is False
    assert is_off_peak("openai", DEEPSEEK_PEAK) is False
