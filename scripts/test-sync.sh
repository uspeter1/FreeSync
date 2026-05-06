#!/bin/bash
# Canonical FreeSync sync validation script.
# QA Engineer owns this file. Run before opening any PR that touches relay or plugin.
set -e

TESTFILE="SyncTest-$(date +%s)"
CONTENT="freesync-$(uuidgen)"

echo "=== FreeSync Sync Validation ==="

echo "1. Creating file in User1..."
obsidian create name="$TESTFILE" content="$CONTENT" vault="FreeSyncUser1" silent

echo "2. Waiting 3s for sync..."
sleep 3

echo "3. Reading from User2..."
RESULT=$(obsidian read file="$TESTFILE" vault="FreeSyncUser2" 2>&1)

if echo "$RESULT" | grep -q "$CONTENT"; then
  echo "✅ PASS: Content synced"
else
  echo "❌ FAIL: Content not synced"
  echo "Expected: $CONTENT"
  echo "Got: $RESULT"
  obsidian dev:errors vault="FreeSyncUser1"
  exit 1
fi

echo "4. Testing deletion..."
obsidian delete file="$TESTFILE" vault="FreeSyncUser1"
sleep 3
DELETED=$(obsidian read file="$TESTFILE" vault="FreeSyncUser2" 2>&1 || true)
if echo "$DELETED" | grep -qi "not found\|error"; then
  echo "✅ PASS: Deletion synced"
else
  echo "❌ FAIL: File still exists in User2 after deletion"
  exit 1
fi

echo "5. Testing presence badges..."
obsidian open file="Phase-Status" vault="FreeSyncUser1"
obsidian open file="Phase-Status" vault="FreeSyncUser2"
sleep 2
BADGES=$(obsidian eval code="document.querySelectorAll('.freesync-badge').length" vault="FreeSyncUser1")
if [ "$BADGES" -gt "0" ]; then
  echo "✅ PASS: Presence badges visible ($BADGES)"
else
  echo "❌ FAIL: No presence badges"
  obsidian dev:screenshot path="/tmp/presence-fail.png" vault="FreeSyncUser1"
  obsidian dev:dom selector=".nav-file-title" vault="FreeSyncUser1"
  exit 1
fi

echo ""
echo "✅ All tests passed"
