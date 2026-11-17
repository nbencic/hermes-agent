"""The compression session split must be all-or-nothing.

Previously end_session → create_session → set_title → update_system_prompt
ran as four transactions and ``agent.session_id`` was reassigned in between.
A failure after end_session left the agent on a row-less id; the next flush
recreated the row with the agent's ORIGINAL parent, severing the lineage.
"""
from pathlib import Path

import pytest

from hermes_state import SessionDB
from tests.agent.test_compression_concurrent_fork import _build_agent_with_db


def _messages():
    return [{"role": "user", "content": f"m{i}"} for i in range(20)]


def test_rotation_success_switches_agent_to_linked_child(tmp_path: Path) -> None:
    db = SessionDB(db_path=tmp_path / "state.db")
    db.create_session("PARENT", source="cli")
    agent = _build_agent_with_db(db, "PARENT")
    agent._last_flushed_db_idx = 7

    agent._compress_context(_messages(), "sys", approx_tokens=120_000)

    assert agent.session_id != "PARENT"
    child = db.get_session(agent.session_id)
    assert child is not None and child["parent_session_id"] == "PARENT"
    assert db.get_session("PARENT")["end_reason"] == "compression"
    assert agent._last_flushed_db_idx == 0
    assert agent._session_db_created is True
    assert db.get_compression_tip("PARENT") == agent.session_id


def test_rotation_failure_keeps_agent_on_open_parent(tmp_path: Path, monkeypatch) -> None:
    db = SessionDB(db_path=tmp_path / "state.db")
    db.create_session("PARENT", source="cli")
    agent = _build_agent_with_db(db, "PARENT")
    agent._last_flushed_db_idx = 7

    def _boom(*_a, **_k):
        raise RuntimeError("disk full")

    monkeypatch.setattr(db, "rotate_session_for_compression", _boom)

    agent._compress_context(_messages(), "sys", approx_tokens=120_000)

    # Nothing moved: the parent is still open, the agent still writes to it,
    # and no orphan child row exists.
    assert agent.session_id == "PARENT"
    assert db.get_session("PARENT")["ended_at"] is None
    assert agent._last_flushed_db_idx == 7
    rows = db._conn.execute(
        "SELECT id FROM sessions WHERE parent_session_id = ?", ("PARENT",)
    ).fetchall()
    assert rows == []
