import { useEffect, useState } from 'react';
import { Button, Input } from '@lumin/ui';
import { t } from '../i18n';
import { listReplyTemplates, type ReplyTemplate } from '../lib/templates';
import { filterTemplates } from '../lib/templates-view';

// The "Mẫu" tab: the shop's shared reply templates (GET /admin/reply-templates, read-only — CRUD lives in
// Admin). Staff search, then COPY a template to paste into Messenger themselves (ADR-011 — the panel never
// injects). Variables like {tên}/{mã đơn}/{STK} stay as literal placeholders for staff to fill in by hand.
export function Templates() {
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'error' } | { status: 'ready'; templates: ReplyTemplate[] }
  >({ status: 'loading' });
  const [query, setQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  function load() {
    setState({ status: 'loading' });
    listReplyTemplates().then((r) =>
      setState(r.ok ? { status: 'ready', templates: r.templates } : { status: 'error' }),
    );
  }
  useEffect(load, []);

  async function copy(tpl: ReplyTemplate) {
    try {
      await navigator.clipboard.writeText(tpl.body);
      setCopiedId(tpl.id);
    } catch {
      setCopiedId(null);
    }
  }

  if (state.status === 'loading') {
    return (
      <div
        className="flex flex-1 items-center justify-center p-6 text-sm text-text-muted"
        role="status"
      >
        {t('templates.loading')}
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-text-muted" role="alert">
          {t('templates.error')}
        </p>
        <Button variant="outline" size="sm" className="min-h-11" onClick={load}>
          {t('templates.retry')}
        </Button>
      </div>
    );
  }

  const { templates } = state;
  const results = filterTemplates(templates, query);

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
      {templates.length > 0 && (
        <Input
          type="search"
          aria-label={t('templates.search.label')}
          placeholder={t('templates.search.placeholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}

      {templates.length === 0 ? (
        <p className="flex flex-1 items-center justify-center p-6 text-center text-sm text-text-muted">
          {t('templates.empty')}
        </p>
      ) : results.length === 0 ? (
        <p className="p-4 text-center text-sm text-text-muted">{t('templates.noMatch')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {results.map((tpl) => (
            <TemplateCard
              key={tpl.id}
              template={tpl}
              copied={copiedId === tpl.id}
              onCopy={() => copy(tpl)}
            />
          ))}
        </ul>
      )}

      {/* ponytail: static hint, not a live link — the prod Admin origin isn't provisioned (same as the
          manifest host_permissions TODO). Wire <a href={ADMIN_URL}> when that origin exists. */}
      <p className="rounded-md border border-dashed border-border-default p-3 text-center text-xs text-text-subtle">
        {t('templates.adminHint')}
      </p>
    </div>
  );
}

// One template: title, the body (line breaks preserved so multi-line templates read right), and a copy
// button. The body carries {tên}/{mã đơn}/… verbatim — staff fill them after pasting.
function TemplateCard({
  template,
  copied,
  onCopy,
}: {
  template: ReplyTemplate;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <li className="flex flex-col gap-2 rounded-md border border-border-subtle bg-surface-card p-3">
      <p className="font-display text-sm font-semibold text-text-strong">{template.title}</p>
      <p className="whitespace-pre-wrap text-sm text-text-body">{template.body}</p>
      <Button variant="outline" size="sm" className="min-h-11 self-start" onClick={onCopy}>
        {copied ? t('templates.copied') : t('templates.copy')}
      </Button>
    </li>
  );
}
