import { useEffect, useRef } from "react"
import { useTrainingProgress } from "@/lib/training/progress"
import { startTour } from "@/lib/training/tours"

// A one-item key in the training-progress store that records the first-run tour
// has been shown. It is not a real training item, just a "seen" flag.
const ONBOARDING_KEY = "onboarding:orientation"

// Auto-launches the Platform Orientation tour the first time a user reaches the
// app. The tour is fully dismissible (Next/Back, Done, Esc, or the close button);
// as soon as it ends — finished OR exited early — we record it as seen so it
// never auto-starts again. Progress is server-saved per user, so this holds
// across devices and sessions.
export function OnboardingTour() {
  const { completed, isLoading, setComplete } = useTrainingProgress()
  const handled = useRef(false)

  useEffect(() => {
    if (isLoading || handled.current) return
    if (completed.has(ONBOARDING_KEY)) return
    handled.current = true

    const markSeen = () => {
      void setComplete(ONBOARDING_KEY, true, "onboarding")
    }

    // Give the app chrome a beat to mount/paint before spotlighting it.
    const timer = window.setTimeout(() => {
      const started = startTour("platform-orientation", { onDestroyed: markSeen })
      // If no anchors were present (nothing to point at), still mark it seen so
      // we don't retry forever.
      if (!started) markSeen()
    }, 900)

    return () => window.clearTimeout(timer)
  }, [isLoading, completed, setComplete])

  return null
}
