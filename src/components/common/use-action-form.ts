'use client'

import { useActionState } from 'react'
import type { ActionResult } from '@/server/actions/result'

// Glue for native `<form action={formAction}>` + useActionState with server actions that return
// ActionResult. React resets an uncontrolled form after its action finishes, so the submitted
// values are kept in the state and fed back as `defaultValue` (fields remount through `key`).

export type FormState<T> = { result: ActionResult<T> | null; values: Record<string, string> }

export function useActionForm<T>(
  run: (values: Record<string, string>) => Promise<ActionResult<T>>,
  onSuccess?: (data: T, values: Record<string, string>) => void,
) {
  return useActionState<FormState<T>, FormData>(
    async (_previous, formData) => {
      const values: Record<string, string> = {}
      for (const [key, value] of formData.entries()) {
        if (typeof value === 'string') values[key] = value
      }
      const result = await run(values)
      if (result.ok) onSuccess?.(result.data, values)
      return { result, values }
    },
    { result: null, values: {} },
  )
}

export function failureOf<T>(state: FormState<T>) {
  return state.result && !state.result.ok ? state.result : null
}
