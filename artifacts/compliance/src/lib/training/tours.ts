import { driver, type DriveStep } from "driver.js"
import "driver.js/dist/driver.css"

// Live, in-app product tours. Each step points at a stable `data-tour` anchor on
// the persistent app chrome (sidebar, top bar) so a tour works from any page.
// Steps whose anchor is absent (e.g. hidden by permission) are skipped rather
// than showing an empty spotlight.

export interface TourStep {
  element?: string
  title: string
  description: string
}

export interface TourDef {
  id: string
  title: string
  description: string
  estMinutes: number
  steps: TourStep[]
}

export const TOURS: TourDef[] = [
  {
    id: "platform-orientation",
    title: "Platform Orientation",
    description:
      "A guided sweep of the workspace — the sidebar, global search, favorites, and notifications — so you know where everything lives.",
    estMinutes: 2,
    steps: [
      {
        title: "Welcome to Packaging Compliance AI",
        description:
          "This quick tour highlights the parts of the workspace you'll use every day. Use Next and Back to move through it — you can close it any time.",
      },
      {
        element: '[data-tour="sidebar"]',
        title: "The navigation sidebar",
        description:
          "Everything is grouped here: My Work, Compliance, Products, Partners, Analytics, and more. Sections expand and collapse to stay tidy.",
      },
      {
        element: '[data-tour="global-search"]',
        title: "Global search",
        description:
          "Jump straight to any package, SKU, or vendor from anywhere in the app.",
      },
      {
        element: '[data-tour="favorites"]',
        title: "Favorites",
        description:
          "Star the tools you use most (hover any sidebar item and click the star) and reach them instantly from this menu.",
      },
      {
        element: '[data-tour="notifications"]',
        title: "Notifications",
        description:
          "Review assignments, SLA warnings, and support updates land here. The badge shows unread items.",
      },
    ],
  },
  {
    id: "finding-your-work",
    title: "Finding Your Work",
    description:
      "Where your assignments, tasks, and deadlines show up, and how to stay on top of them.",
    estMinutes: 1,
    steps: [
      {
        element: '[data-tour="sidebar"]',
        title: "Start in My Work",
        description:
          "The top 'My Work' section is scoped to you: My Dashboard, My Reviews, My Tasks, and My Notifications. It only shows what's assigned to you.",
      },
      {
        element: '[data-tour="notifications"]',
        title: "Watch your notifications",
        description:
          "New assignments and approaching deadlines are pushed here — check it at the start of each day.",
      },
      {
        element: '[data-tour="global-search"]',
        title: "Find a specific item fast",
        description:
          "Know the SKU or vendor? Search takes you straight there instead of scrolling a queue.",
      },
    ],
  },
  {
    id: "navigation-tour",
    title: "Navigating the Platform",
    description:
      "A guided walk through the left navigation — every section in the sidebar and what lives inside it.",
    estMinutes: 2,
    steps: [
      {
        element: '[data-tour="sidebar"]',
        title: "The navigation sidebar",
        description:
          "Everything in the platform is grouped into the labeled sections here. Sections expand and collapse to keep the list tidy — here's what each one holds.",
      },
      {
        element: '[data-tour="nav-my-work"]',
        title: "My Work",
        description:
          "Your personal hub: your dashboard, the reviews assigned to you, your tasks, and your notifications. Start your day here.",
      },
      {
        element: '[data-tour="nav-home"]',
        title: "Home",
        description:
          "The main compliance dashboard, plus the shortcut to create a new package from artwork.",
      },
      {
        element: '[data-tour="nav-review-operations"]',
        title: "Review Operations",
        description:
          "Work queues for getting through reviews quickly — the high-risk queue, your assigned reviews, bulk review, and fast review.",
      },
      {
        element: '[data-tour="nav-products"]',
        title: "Packages",
        description:
          "Every package, organized by status: all packages, active reviews, approved, rejected, and archived.",
      },
      {
        element: '[data-tour="nav-compliance"]',
        title: "Compliance",
        description:
          "The heart of the platform: the violations center, claim and language reviews, recommended fixes, compliance intelligence, and the regulatory hub.",
      },
      {
        element: '[data-tour="nav-partners"]',
        title: "Suppliers",
        description:
          "Everything supplier-facing: the vendor directory, vendor scorecards, and the supplier portal.",
      },
      {
        element: '[data-tour="nav-knowledge"]',
        title: "Knowledge",
        description:
          "Your reference library: the resource center, policy repository, SOP documents, and approved language.",
      },
      {
        element: '[data-tour="nav-training"]',
        title: "Training & Help",
        description:
          "Where you are now — guides, walkthroughs, the Compliance Academy, FAQs, and Contact Support. Open to everyone.",
      },
    ],
  },
  {
    id: "getting-help",
    title: "Getting Help",
    description:
      "Where to find guides, walkthroughs, and how to reach support without leaving the platform.",
    estMinutes: 1,
    steps: [
      {
        element: '[data-tour="sidebar"]',
        title: "Training & Help lives in the sidebar",
        description:
          "Scroll to the 'Training & Help' section for the User Guide, walkthroughs, the Compliance Academy, FAQs, and Contact Support.",
      },
      {
        element: '[data-tour="notifications"]',
        title: "Support replies come back here",
        description:
          "When an admin responds to a support request you filed, you'll get a notification.",
      },
    ],
  },
]

export function getTour(id: string): TourDef | undefined {
  return TOURS.find((t) => t.id === id)
}

export interface StartTourOptions {
  // Fires once the tour ends — whether the user finished it or exited early
  // (Esc, the close button, or clicking the overlay).
  onDestroyed?: () => void
}

// Drive an arbitrary set of steps. Steps whose anchor is absent are skipped so a
// tour never shows an empty spotlight. Returns true if it started (at least one
// step remained), false otherwise.
export function startTourSteps(steps: TourStep[], options?: StartTourOptions): boolean {
  const driveSteps: DriveStep[] = steps
    .filter((s) => !s.element || document.querySelector(s.element))
    .map((s) => ({
      element: s.element,
      popover: {
        title: s.title,
        description: s.description,
      },
    }))

  if (driveSteps.length === 0) return false

  const d = driver({
    showProgress: true,
    allowClose: true,
    overlayColor: "rgba(2, 6, 23, 0.6)",
    nextBtnText: "Next",
    prevBtnText: "Back",
    doneBtnText: "Done",
    onDestroyed: () => {
      options?.onDestroyed?.()
    },
    steps: driveSteps,
  })
  d.drive()
  return true
}

// Launch a predefined live tour by id. Safe to call from any page. Returns true
// if the tour actually started (at least one anchor was present), false otherwise.
export function startTour(id: string, options?: StartTourOptions): boolean {
  const def = getTour(id)
  if (!def) return false
  return startTourSteps(def.steps, options)
}
