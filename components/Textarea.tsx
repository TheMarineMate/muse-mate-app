import { forwardRef, type TextareaHTMLAttributes } from 'react'

// Multi-line field styled to match @intelligent-mate/ui's Input. Extraction
// candidate for the shared package (Section 17).
export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }
>(function Textarea({ label, id, className = '', ...props }, ref) {
  return (
    <div className="mm-field">
      {label && (
        <label className="mm-field__label" htmlFor={id}>
          {label}
        </label>
      )}
      <textarea id={id} ref={ref} className={`mm-control ${className}`.trim()} {...props} />
    </div>
  )
})
