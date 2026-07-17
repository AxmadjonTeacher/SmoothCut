/** Shared primitive controls for the recorder panel: segmented control + dropdown. */
import { useEffect, useRef, useState } from 'react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
  /** Small tag rendered next to the label, e.g. "soon". */
  hint?: string;
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
          {o.hint ? <span className="seg-hint">{o.hint}</span> : null}
        </button>
      ))}
    </div>
  );
}

function ChevronIcon() {
  return (
    <svg className="dd-chevron" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path
        d="M2 3.5 5 6.5 8 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export interface DropdownItem {
  id: string;
  label: string;
  sublabel?: string;
}

interface DropdownProps {
  items: DropdownItem[];
  selectedId: string | null;
  placeholder: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  disabled?: boolean;
  onSelect: (id: string) => void;
  /** Called right before the popover opens (e.g. to refresh the source list). */
  onOpen?: () => void;
}

export function Dropdown({
  items,
  selectedId,
  placeholder,
  searchable,
  searchPlaceholder,
  disabled,
  onSelect,
  onOpen,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const root = rootRef.current;
      if (root && e.target instanceof Node && !root.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery('');
      searchRef.current?.focus();
    }
  }, [open]);

  const selected = items.find((i) => i.id === selectedId) ?? null;
  const q = query.trim().toLowerCase();
  const visible = q
    ? items.filter((i) => `${i.label} ${i.sublabel ?? ''}`.toLowerCase().includes(q))
    : items;

  return (
    <div className="dd" ref={rootRef}>
      <button
        type="button"
        className={open ? 'dd-trigger open' : 'dd-trigger'}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (!open) onOpen?.();
          setOpen(!open);
        }}
      >
        <span className={selected ? 'dd-label' : 'dd-label placeholder'}>
          {selected ? selected.label : placeholder}
        </span>
        {selected?.sublabel ? <span className="dd-sublabel">{selected.sublabel}</span> : null}
        <ChevronIcon />
      </button>
      {open ? (
        <div className="dd-pop" role="listbox">
          {searchable ? (
            <input
              ref={searchRef}
              className="dd-search"
              type="text"
              placeholder={searchPlaceholder ?? 'Search…'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              spellCheck={false}
            />
          ) : null}
          <div className="dd-list">
            {visible.length === 0 ? <div className="dd-empty">No matches</div> : null}
            {visible.map((i) => (
              <button
                key={i.id}
                type="button"
                role="option"
                aria-selected={i.id === selectedId}
                className={i.id === selectedId ? 'dd-item selected' : 'dd-item'}
                onClick={() => {
                  onSelect(i.id);
                  setOpen(false);
                }}
              >
                <span className="dd-item-label">{i.label}</span>
                {i.sublabel ? <span className="dd-item-sub">{i.sublabel}</span> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
