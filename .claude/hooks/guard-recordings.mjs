#!/usr/bin/env node
/**
 * PreToolUse hook: blocks destructive shell deletion of the user's recording
 * bundles (~/Movies/SmoothCut). Agents must use the app's trash-safe
 * `project:delete` IPC (shell.trashItem) or the `trash` command instead.
 * Exit 2 = block the tool call and surface the message to the model.
 */
let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(raw);
    const command = String(payload?.tool_input?.command ?? '');
    const touchesRecordings = /Movies\/SmoothCut|SmoothCut\/[0-9a-f-]+\.smoothcut/i.test(command);
    const destructive = /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*r[a-zA-Z]*)\b|\brm\s+-rf\b|\bunlink\b|\bfind\b[^\n]*-delete/.test(
      command,
    );
    if (touchesRecordings && destructive) {
      process.stderr.write(
        'Blocked: destructive deletion under ~/Movies/SmoothCut (user recordings). ' +
          'Use the app\'s project:delete IPC or the `trash` command, and only on bundles you created.',
      );
      process.exit(2);
    }
  } catch {
    // Unparseable input: don't block.
  }
  process.exit(0);
});
