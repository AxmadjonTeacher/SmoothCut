export const meta = {
  name: 'smoke',
  description: 'SmoothCut smoke: static gates + full record→edit→export proof chain in parallel',
  whenToUse: 'After a substantive change, before committing — verifies the app actually works, not just compiles.',
  phases: [{ title: 'Verify', detail: 'static gates + harness E2E in parallel' }],
}

phase('Verify')

const REPORT = {
  type: 'object',
  properties: {
    passed: { type: 'boolean' },
    stages: { type: 'string', description: 'One line per stage: pass/fail + concrete evidence' },
    anomalies: { type: 'string' },
  },
  required: ['passed', 'stages', 'anomalies'],
}

const [gates, e2e] = await parallel([
  () =>
    agent(
      'In the SmoothCut repo (see CLAUDE.md): run `pnpm typecheck`, `pnpm test`, and ' +
        '`pnpm --filter @smoothcut/desktop build` from the repo root. Report each result ' +
        'with counts/errors verbatim. Do not modify any files.',
      { label: 'static-gates', phase: 'Verify', schema: REPORT, effort: 'low' },
    ),
  () =>
    agent(
      'Run the SmoothCut end-to-end proof chain exactly as specified in your agent ' +
        'definition (record → editor screenshot → export → frame inspection, then ' +
        'trash-safe cleanup of only the bundle you created).',
      { label: 'e2e', phase: 'Verify', schema: REPORT, agentType: 'e2e-verifier' },
    ),
])

return {
  passed: Boolean(gates && gates.passed && e2e && e2e.passed),
  gates,
  e2e,
}
