#!/usr/bin/env bash
# Coordinated CPU gates after approved V4 publication. No GPU/browser work here.
set -u
cd /data/worktrees/ui-hud-669eb5 || exit 2
out=tasks/evidence/ui-redesign-2026-07-02
status=0
printf 'correction CPU start %s\n' "$(date -u +%FT%TZ)" > "$out/correction-cpu-status.log"
run_gate() {
  name=$1; shift
  printf '%s start %s\n' "$name" "$(date -u +%FT%TZ)" >> "$out/correction-cpu-status.log"
  "$@" > "$out/correction-$name.log" 2>&1
  code=$?
  printf '%s exit=%s end %s\n' "$name" "$code" "$(date -u +%FT%TZ)" >> "$out/correction-cpu-status.log"
  if [ "$code" -ne 0 ]; then status=1; fi
}
run_gate world npm --prefix client run world:generate
run_gate client-tests make client-test
run_gate client-check npm --prefix client run check
run_gate client-imports npm --prefix client run check:imports
run_gate server-tests make server-test
run_gate server-check npm --prefix server run check
run_gate client-build npm --prefix client run build
printf 'correction CPU end exit=%s %s\n' "$status" "$(date -u +%FT%TZ)" >> "$out/correction-cpu-status.log"
exit "$status"
