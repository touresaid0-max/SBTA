import { type ReactNode } from 'react';

interface PlaceholderProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
}

export default function Placeholder({ title, subtitle, icon, action }: PlaceholderProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      {icon && (
        <div
          className="w-20 h-20 rounded-3xl flex items-center justify-center mb-6"
          style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}
        >
          {icon}
        </div>
      )}
      <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
        {title}
      </h1>
      {subtitle && (
        <p className="text-sm max-w-sm" style={{ color: 'var(--text-secondary)' }}>
          {subtitle}
        </p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
