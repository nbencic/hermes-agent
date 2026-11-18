import { normalizeOrLocalPreviewTarget } from '@/lib/local-preview'
import { notifyError } from '@/store/notifications'
import { setCurrentSessionPreviewTarget } from '@/store/preview'
import type { SessionInfo } from '@/types/hermes'

// Script-only (no_agent) runs never open a session; the saved report is the
// run, so they open in the file preview instead of a session route.
export function isScriptRun(run: SessionInfo): boolean {
  return run.run_kind === 'script'
}

export async function openCronRunOutput(path: string, unavailableLabel: string) {
  try {
    const preview = await normalizeOrLocalPreviewTarget(path)

    if (!preview) {
      throw new Error(unavailableLabel)
    }

    setCurrentSessionPreviewTarget(preview, 'manual', path)
  } catch (error) {
    notifyError(error, unavailableLabel)
  }
}
