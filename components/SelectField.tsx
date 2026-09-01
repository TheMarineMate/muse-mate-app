import { forwardRef, type SelectHTMLAttributes } from 'react'

export type SelectOption = { value: string; label: string }

// "Pick one from a small enum" — the shared VenturePicker-style gap called out
// in Section 17. Extraction candidate for the shared package.
export const SelectField = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & { label?: string; options: SelectOption[] }
>(function SelectField({ label, id, options, className = '', ...props }, ref) {
  return (
    <div className="mm-field">
      {label && (
        <label className="mm-field__label" htmlFor={id}>
          {label}
        </label>
      )}
      <select id={id} ref={ref} className={`mm-control ${className}`.trim()} {...props}>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
})
