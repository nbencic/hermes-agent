import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CronJob, SessionInfo } from '@/types/hermes'

const getCronJobRuns = vi.fn()
const normalizeOrLocalPreviewTarget = vi.fn()
const setCurrentSessionPreviewTarget = vi.fn()

vi.mock('@/hermes', () => ({
  getCronJobRuns: (jobId: string, limit: number) => getCronJobRuns(jobId, limit)
}))

vi.mock('@/lib/local-preview', () => ({
  normalizeOrLocalPreviewTarget: (path: string) => normalizeOrLocalPreviewTarget(path)
}))

vi.mock('@/store/preview', () => ({
  setCurrentSessionPreviewTarget: (...args: unknown[]) => setCurrentSessionPreviewTarget(...args)
}))

vi.mock('@/store/notifications', () => ({
  notify: vi.fn(),
  notifyError: vi.fn()
}))

const OUTPUT_PATH = '/home/u/.hermes/cron/output/job1/2026-11-18_17-48-56.md'

function run(overrides: Partial<SessionInfo>): SessionInfo {
  return {
    ended_at: 1_763_484_536,
    id: 'cron_job1_20261118_174856',
    input_tokens: 0,
    is_active: false,
    last_active: 1_763_484_536,
    message_count: 0,
    model: null,
    output_tokens: 0,
    preview: null,
    source: 'cron',
    started_at: 1_763_484_536,
    title: 'Disk watch · Nov 18 17:48',
    tool_call_count: 0,
    ...overrides
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SidebarCronJobsSection run peek', () => {
  it('opens a script run in the file preview instead of a session', async () => {
    const target = { kind: 'file', label: '2026-11-18_17-48-56.md', source: OUTPUT_PATH, url: `file://${OUTPUT_PATH}` }
    normalizeOrLocalPreviewTarget.mockResolvedValue(target)
    getCronJobRuns.mockResolvedValue([
      run({ output_path: OUTPUT_PATH, preview: 'silent (empty output)', run_kind: 'script' }),
      run({ id: 'cron_job1_20261118_160000', last_active: 1_763_478_000, started_at: 1_763_478_000 })
    ])
    const onOpenRun = vi.fn()
    const { SidebarCronJobsSection } = await import('./cron-jobs-section')

    render(
      <SidebarCronJobsSection
        jobs={[{ enabled: true, id: 'job1', name: 'Disk watch' } as CronJob]}
        label="Cron jobs"
        onManageJob={vi.fn()}
        onOpenRun={onOpenRun}
        onToggle={vi.fn()}
        onTriggerJob={vi.fn()}
        open
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Show runs' }))
    await waitFor(() => expect(getCronJobRuns).toHaveBeenCalledWith('job1', 5))
    const [scriptRow, agentRow] = await screen.findAllByRole('button', { name: /\d:\d\d/ })

    fireEvent.click(scriptRow)
    await waitFor(() => expect(setCurrentSessionPreviewTarget).toHaveBeenCalledWith(target, 'manual', OUTPUT_PATH))
    expect(normalizeOrLocalPreviewTarget).toHaveBeenCalledWith(OUTPUT_PATH)
    expect(onOpenRun).not.toHaveBeenCalled()

    fireEvent.click(agentRow)
    expect(onOpenRun).toHaveBeenCalledWith('cron_job1_20261118_160000')
  })
})
