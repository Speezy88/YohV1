"""Orientation + cost metrics for Claude Code subagent transcripts.

Usage: python3 scripts/agent-metrics.py ~/.claude/projects/<proj>/<session>/subagents/agent-<id>.jsonl [...]
Prints per agent: turns, max context, cache reads, and — before the first code
edit — turn number, context size, read/search calls, plus any plan/architecture
files opened. Targets (docs/process/implementer-contract.md): first edit within
~15 turns; ≤80k context single-layer, ≤100k cross-layer.
"""
import json, sys, re
for f in sys.argv[1:]:
    seen = set(); turns = 0; ctx = 0; cr = 0; first = None; reads = 0; offs = set(); maxctx = 0
    for line in open(f, errors='ignore'):
        try: d = json.loads(line)
        except Exception: continue
        m = d.get('message') or {}
        u = m.get('usage')
        if u and m.get('role') == 'assistant' and m.get('id') not in seen:
            seen.add(m.get('id')); turns += 1
            ctx = (u.get('cache_read_input_tokens') or 0) + (u.get('cache_creation_input_tokens') or 0) + (u.get('input_tokens') or 0)
            cr += u.get('cache_read_input_tokens') or 0; maxctx = max(maxctx, ctx)
        ct = m.get('content')
        if not isinstance(ct, list): continue
        for x in ct:
            if not (isinstance(x, dict) and x.get('type') == 'tool_use'): continue
            n = x.get('name'); i = x.get('input', {}); t = i.get('file_path') or i.get('command') or ''
            if n != 'Write' and re.search(r'_bmad-output/|docs/superpowers/plans/|ARCHITECTURE|spine|prd\.md|epics?\.md', t): offs.add(t[:70])
            if first is None:
                if n in ('Edit', 'Write') and 'report' not in t: first = (turns, ctx, reads)
                elif n == 'Read' or (n == 'Bash' and re.search(r'cat |sed -n|grep|find |head|git ', t)): reads += 1
    print(f.split('agent-')[-1][:12], f"turns={turns} maxctx={maxctx//1000}k cache_reads={cr/1e6:.1f}M first_edit: turn={first[0]} ctx={first[1]//1000}k reads={first[2]}", "off-brief:", offs or 'none')
