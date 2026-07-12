import type { ComponentType } from "react"

// Shared content shapes for the Training Center. All copy lives in the
// content-*.ts modules so pages stay small and consistent.

export interface ChecklistStep {
  key: string
  title: string
  description: string
  href?: string
  cta?: string
}

export interface WalkthroughStep {
  title: string
  detail: string
}

export interface Walkthrough {
  key: string
  title: string
  description: string
  audience: string
  estMinutes: number
  steps: WalkthroughStep[]
  // When set, this walkthrough can also be launched as a live in-app tour.
  liveTourId?: string
  relatedHref?: string
}

export interface VideoTutorial {
  key: string
  title: string
  description: string
  duration: string
  level: "Beginner" | "Intermediate" | "Advanced"
  category: string
  outline: string[]
  // Drop a URL here later to enable the embedded player.
  videoUrl?: string | null
}

export interface BestPractice {
  key: string
  title: string
  category: string
  summary: string
  tips: string[]
}

export interface AcademyLesson {
  title: string
  points: string[]
}

export interface AcademyCourse {
  key: string
  title: string
  description: string
  level: "Foundational" | "Intermediate" | "Advanced"
  estMinutes: number
  lessons: AcademyLesson[]
}

export interface GuideArticle {
  key: string
  title: string
  audience?: string
  body: string[]
}

export interface GuideSection {
  id: string
  title: string
  icon: ComponentType<{ className?: string }>
  summary: string
  articles: GuideArticle[]
}

export interface FaqItem {
  q: string
  a: string
}

export interface FaqCategory {
  category: string
  items: FaqItem[]
}

export interface GlossaryTerm {
  term: string
  definition: string
  category: string
  related?: string[]
}

export interface ReleaseNote {
  version: string
  date: string
  title: string
  summary: string
  changes: { type: "feature" | "improvement" | "fix"; text: string }[]
}
