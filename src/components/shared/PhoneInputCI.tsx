import { useState, type CSSProperties } from 'react';
import { formatPhoneCI, normalizePhoneCI, phoneCIError } from '@/utils/phoneCI';

interface Props {
  id?: string;
  /** The 10 national digits ('' when empty). */
  value: string;
  onChange: (national: string) => void;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  style?: CSSProperties;
  /** Show the error at once (e.g. after a submit attempt), not only after leaving the field. */
  showError?: boolean;
}

/**
 * Côte d'Ivoire phone field (audit M10): the country code +225 is shown apart and never typed,
 * only digits are kept, typing stops at the 10th digit, a pasted number (+225 07 59…, 00225…) is
 * cleaned, and the number shows by pairs. The error appears when the field is left incomplete or
 * with a wrong prefix.
 */
export default function PhoneInputCI({
  id, value, onChange, required = false, disabled = false,
  placeholder = '07 00 00 00 00', className = '', style, showError = false,
}: Props) {
  const [touched, setTouched] = useState(false);
  const error = phoneCIError(value, required);
  const visibleError = (touched || showError) && error;

  return (
    <div>
      <div className="flex items-stretch gap-0">
        <span
          className={`flex items-center px-2.5 text-sm font-semibold rounded-l-lg ${/\bborder-2\b/.test(className) ? 'border-2' : 'border'} border-r-0 select-none`}
          style={{ borderColor: visibleError ? 'var(--danger)' : 'var(--border)', backgroundColor: 'var(--surface-raised, var(--surface))', color: 'var(--text-secondary)' }}
          aria-hidden="true"
        >
          +225
        </span>
        <input
          id={id}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          value={formatPhoneCI(value)}
          onChange={e => onChange(normalizePhoneCI(e.target.value))}
          onBlur={() => setTouched(true)}
          disabled={disabled}
          required={required}
          // No maxLength: it would cut a pasted "+225 07 59 81 81 55" before it is cleaned;
          // the cleaning itself stops at 10 digits
          placeholder={placeholder}
          aria-invalid={visibleError ? true : undefined}
          aria-label={id ? undefined : 'Numéro de téléphone (10 chiffres)'}
          className={`${className} rounded-l-none`}
          style={{ ...style, ...(visibleError ? { borderColor: 'var(--danger)' } : {}) }}
        />
      </div>
      {visibleError && (
        <p className="text-xs mt-1" style={{ color: 'var(--danger)' }} role="alert">{error}</p>
      )}
    </div>
  );
}
