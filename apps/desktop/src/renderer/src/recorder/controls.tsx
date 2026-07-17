/** Shared primitive controls for the recorder pill: segmented control. */

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  small?: boolean;
  ariaLabel?: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled,
  small,
  ariaLabel,
}: SegmentedProps<T>) {
  return (
    <div className={small ? 'seg seg-small' : 'seg'} role="tablist" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          className={o.value === value ? 'seg-item active' : 'seg-item'}
          disabled={disabled || o.disabled}
          onClick={() => {
            if (o.value !== value) onChange(o.value);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
