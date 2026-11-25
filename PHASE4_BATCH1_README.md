# Phase 4 — Batch 1: Support Ticket Classification & Priority Triage

## Files to create
- `ai-service/app/schemas/ticket_triage.py`
- `ai-service/app/services/ticket_triage.py`
- `ai-service/tests/test_ticket_triage.py`

## Files to replace
- `ai-service/app/schemas/orchestration.py`
- `ai-service/app/services/orchestrator.py`

## What this batch adds
- Deterministic support-category classification.
- Explainable priority score from 0–100.
- P1/P2/P3/P4 priority and CRITICAL/HIGH/MEDIUM/LOW severity.
- Lightweight sentiment classification.
- Urgency signals and suggested response SLA.
- Triage metadata in `/api/v1/orchestrator/run`.

## Safety / scope
This batch only classifies and recommends. It does not create tickets, assign agents,
modify orders, issue refunds, or perform any other business operation. The existing
backend authorization and ticket workflow must remain responsible for those actions.

## Run tests
From `ai-service/`:

```bash
python -m pytest tests/test_ticket_triage.py tests/test_orchestrator.py tests/test_routing_engine.py -q
```

Then run the complete AI-service suite:

```bash
python -m pytest -q
```

No new Python dependency is required.
