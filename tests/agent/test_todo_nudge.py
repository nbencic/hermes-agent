"""The open-todo nudge: fire once when a final answer leaves plan items open."""

import types

from agent.conversation_loop import _build_todo_nudge_message, _open_todo_items
from tools.todo_tool import TodoStore


def _agent(items, tools=("todo", "terminal")):
    store = TodoStore()
    if items:
        store.write(items, merge=False)
    return types.SimpleNamespace(_todo_store=store, valid_tool_names=set(tools))


def test_open_items_filters_to_pending_and_in_progress():
    agent = _agent([
        {"id": "1", "content": "a", "status": "completed"},
        {"id": "2", "content": "b", "status": "in_progress"},
        {"id": "3", "content": "c", "status": "pending"},
        {"id": "4", "content": "d", "status": "cancelled"},
    ])
    assert [i["id"] for i in _open_todo_items(agent)] == ["2", "3"]


def test_open_items_empty_when_tool_disabled_or_store_missing():
    assert _open_todo_items(_agent([{"id": "1", "content": "a", "status": "pending"}], tools=("terminal",))) == []
    assert _open_todo_items(types.SimpleNamespace(valid_tool_names={"todo"})) == []
    assert _open_todo_items(_agent([])) == []


def test_nudge_message_lists_items_and_is_marked_synthetic():
    msg = _build_todo_nudge_message([
        {"id": "1", "content": "On-chain anchors", "status": "in_progress"},
        {"id": "2", "content": "Volume profile", "status": "pending"},
    ])
    assert msg["role"] == "user"
    assert msg["_todo_nudge_synthetic"] is True
    assert "2 open item(s)" in msg["content"]
    assert "[in_progress] 1: On-chain anchors" in msg["content"]
    assert "[pending] 2: Volume profile" in msg["content"]
    assert "merge mode" in msg["content"]
    assert "Do not repeat your answer" in msg["content"]


def test_nudge_message_caps_listed_items():
    items = [{"id": str(i), "content": f"item {i}", "status": "pending"} for i in range(12)]
    content = _build_todo_nudge_message(items)["content"]
    assert "12 open item(s)" in content
    assert "item 7" in content
    assert "item 8" not in content
    assert "and 4 more" in content
