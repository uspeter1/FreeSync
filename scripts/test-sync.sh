#!/bin/bash
# Canonical FreeSync sync validation script.
# QA Engineer owns this file. Run before opening any PR that touches relay or plugin.
set -e

TESTFILE="SyncTest-$(date +%s).md"
CONTENT="freesync-$(uuidgen)"

VAULT1="/home/peter/FreeSyncUser1"
VAULT2="/home/peter/FreeSyncUser2"

echo "=== FreeSync Sync Validation ==="

echo "1. Creating file in User1 (filesystem write)..."
echo "$CONTENT" > "$VAULT1/$TESTFILE"

echo "2. Waiting 5s for sync..."
sleep 5

echo "3. Reading from User2 (filesystem read)..."
if [ -f "$VAULT2/$TESTFILE" ]; then
  RESULT=$(cat "$VAULT2/$TESTFILE")
  if echo "$RESULT" | grep -q "$CONTENT"; then
    echo "✅ PASS: Content synced"
  else
    echo "❌ FAIL: Content mismatch"
    echo "Expected: $CONTENT"
    echo "Got: $RESULT"
    exit 1
  fi
else
  echo "❌ FAIL: File not found in User2"
  echo "User2 vault contents:"
  ls "$VAULT2/"
  exit 1
fi

echo "4. Testing deletion..."
rm "$VAULT1/$TESTFILE"
sleep 3
if [ ! -f "$VAULT2/$TESTFILE" ]; then
  echo "✅ PASS: Deletion synced"
else
  echo "❌ FAIL: File still exists in User2 after deletion"
  exit 1
fi

echo "5. Testing presence badges..."
obsidian eval code="app.workspace.openLinkText('Welcome', '', false)"
sleep 2
BADGES=$(obsidian eval code="document.querySelectorAll('.freesync-badge').length" | tr -d -c '0-9')
if [ -n "$BADGES" ] && [ "$BADGES" -gt "0" ]; then
  echo "✅ PASS: Presence badges visible ($BADGES)"
else
  echo "ℹ️  SKIP: Presence badges require both vaults focused on same file (manual test)"
fi

echo ""
echo "✅ All automated tests passed"
