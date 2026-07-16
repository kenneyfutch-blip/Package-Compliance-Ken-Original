import * as React from "react"
import { cn } from "@/lib/utils"
import {
  getSpecialistProfile,
  specialistInitials,
} from "@/lib/specialist-profiles"

interface SpecialistAvatarProps {
  /** Specialist key (e.g. "compliance"). */
  specialistKey: string | undefined
  /** Role label, used for alt text and the initials fallback. */
  label?: string
  /** Rendered square size in pixels. */
  size?: number
  /** Show a small "online" presence dot (for the active persona). */
  showStatus?: boolean
  /** Avatar shape. Defaults to a circle; "square" uses rounded corners. */
  shape?: "circle" | "square"
  className?: string
}

/**
 * Circular headshot for an AI specialist "employee". Falls back to initials on
 * a branded chip when a persona has no photo (or the image fails to load).
 */
export function SpecialistAvatar({
  specialistKey,
  label,
  size = 28,
  showStatus = false,
  shape = "circle",
  className,
}: SpecialistAvatarProps) {
  const profile = getSpecialistProfile(specialistKey, label)
  const [broken, setBroken] = React.useState(false)
  // Reset the error state whenever the resolved photo changes, so a transient
  // load failure on one persona never leaves this instance stuck on initials
  // after switching to a different specialist with a valid photo.
  React.useEffect(() => setBroken(false), [profile.photo])
  const showPhoto = Boolean(profile.photo) && !broken
  const statusSize = Math.max(7, Math.round(size * 0.28))
  const radiusClass = shape === "square" ? "rounded-xl" : "rounded-full"

  return (
    <span
      className={cn("relative inline-flex shrink-0", className)}
      style={{ width: size, height: size }}
    >
      {showPhoto ? (
        <img
          src={profile.photo}
          alt={profile.name}
          width={size}
          height={size}
          loading="lazy"
          onError={() => setBroken(true)}
          className={cn(
            "h-full w-full object-cover ring-1 ring-border",
            radiusClass,
          )}
        />
      ) : (
        <span
          className={cn(
            "flex h-full w-full items-center justify-center font-semibold uppercase ring-1",
            radiusClass,
            profile.fallbackClass,
          )}
          style={{ fontSize: Math.max(9, Math.round(size * 0.38)) }}
        >
          {specialistInitials(profile.name)}
        </span>
      )}
      {showStatus && (
        <span
          className="absolute bottom-0 right-0 rounded-full bg-emerald-500 ring-2 ring-background"
          style={{ width: statusSize, height: statusSize }}
          aria-hidden
        />
      )}
    </span>
  )
}
