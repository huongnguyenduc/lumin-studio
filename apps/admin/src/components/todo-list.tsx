import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { formatVnNumber } from '@lumin/core';
import { Card } from '@lumin/ui';
import type { TodoItem } from '@/lib/dashboard';
import { ArrowRightIcon } from './icons';

/**
 * "Cần xử lý" action list (design: Lumin Admin Hi-fi). Each row = a count + a label + an arrow link
 * into the relevant queue. Counts via formatVnNumber, labels via i18n. Data comes from GET
 * /admin/dashboard via the page (PR-3j); server component.
 */
export function TodoList({ todos }: { todos: TodoItem[] }) {
  const t = useTranslations('dashboard');

  return (
    <Card elevation="md" className="flex flex-col p-5">
      <h2 className="mb-2 text-lg">{t('todo')}</h2>
      <ul className="flex flex-col">
        {todos.map((todo) => (
          <li key={todo.labelKey}>
            <Link
              href={todo.href}
              className="-mx-2 flex min-h-[44px] items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2"
            >
              <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-accent-flame-soft px-2 font-mono text-sm font-bold text-text-strong">
                {formatVnNumber(todo.count)}
              </span>
              <span className="flex-1 text-sm text-text-body">{t(todo.labelKey)}</span>
              <ArrowRightIcon className="h-4 w-4 text-text-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
