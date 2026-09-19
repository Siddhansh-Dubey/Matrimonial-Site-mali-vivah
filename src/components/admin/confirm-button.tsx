'use client'

import type { ButtonHTMLAttributes, MouseEvent } from 'react'

/**
 * Submit button that asks for confirmation before the (server-action) form
 * it lives in is submitted. Works without any other client state, so the
 * admin pages stay Server Components; on phones the native confirm sheet is
 * the most reliable dialog available.
 */
export function ConfirmButton({
  message,
  onClick,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { message: string }) {
  return (
    <button
      type="submit"
      {...rest}
      onClick={(e: MouseEvent<HTMLButtonElement>) => {
        if (!window.confirm(message)) {
          e.preventDefault()
          return
        }
        onClick?.(e)
      }}
    >
      {children}
    </button>
  )
}
