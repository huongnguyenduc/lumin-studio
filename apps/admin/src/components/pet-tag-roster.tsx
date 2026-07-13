'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { formatVnDate } from '@lumin/core';
import { Badge, Card, cn } from '@lumin/ui';
import {
  PET_TAG_STATUS_BADGE,
  PET_TAG_STATUSES,
  filterByStatus,
  speciesEmoji,
  statusCounts,
  type AdminPetTag,
  type PetTagStatus,
} from '@/lib/pet-tags';

/**
 * Pet Tag roster (P3-t t-5, spec §10 "Màn Pet Tag", design Admin #9). The RSC fetches the whole roster once
 * (unpaginated — the tag base is small) and hands it here; the 3-status filter is a client chip over the
 * full list, so the chip counts are live with no re-fetch (mirrors the customers search). Each row shows the
 * code, lifecycle badge, chip UID + pet-page URL, and — once ACTIVATED — the linked pet's emoji/name/@handle;
 * a lost pet gets a danger badge. Empty states are split (conventions §State): a truly empty roster gets the
 * "no tags yet" note, an empty status filter a lighter "none in this status".
 */
export function PetTagRoster({ tags }: { tags: AdminPetTag[] }) {
  const t = useTranslations('petTag');
  const [status, setStatus] = useState<PetTagStatus | null>(null);

  const counts = useMemo(() => statusCounts(tags), [tags]);
  const filtered = useMemo(() => filterByStatus(tags, status), [tags, status]);

  // Nothing at all → the full empty state; there is nothing to filter, so no chips.
  if (tags.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <Header count={0} />
        <div className="rounded-xl border-2 border-dashed border-border-strong bg-surface-card px-6 py-16 text-center text-text-muted">
          {t('empty')}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Header count={tags.length} />

      {/* Status filter chips — counts computed from the full list (live, no re-fetch). */}
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('filterLabel')}>
        <FilterChip
          label={t('filter.all')}
          count={counts.all}
          active={status === null}
          onClick={() => setStatus(null)}
        />
        {PET_TAG_STATUSES.map((s) => (
          <FilterChip
            key={s}
            label={t(`status.${s}`)}
            count={counts[s]}
            active={status === s}
            onClick={() => setStatus(s)}
          />
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-border-strong bg-surface-card px-6 py-12 text-center text-text-muted">
          {t('noneInStatus')}
        </div>
      ) : (
        <Card elevation="md" className="overflow-x-auto p-0">
          <table className="w-full min-w-[48rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border-subtle text-left text-text-muted">
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('colTag')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('colStatus')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('colChipUrl')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('colPet')}
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((tag) => (
                <PetTagRow key={tag.id} tag={tag} />
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function Header({ count }: { count: number }) {
  const t = useTranslations('petTag');
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <h1 className="font-display text-2xl font-semibold text-text-strong">{t('title')}</h1>
        <span className="font-mono text-sm text-text-muted">{t('count', { count })}</span>
      </div>
      <p className="mt-1 text-sm text-text-muted">{t('subtitle')}</p>
    </div>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex min-h-[44px] items-center gap-1.5 rounded-pill border px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2',
        active
          ? 'border-primary bg-primary text-on-primary'
          : 'border-border-strong text-text-body hover:bg-surface-sunken',
      )}
    >
      <span>{label}</span>
      <span className={cn('font-mono text-xs', active ? 'text-on-primary' : 'text-text-muted')}>
        {count}
      </span>
    </button>
  );
}

function PetTagRow({ tag }: { tag: AdminPetTag }) {
  const t = useTranslations('petTag');
  const badge = PET_TAG_STATUS_BADGE[tag.status];
  return (
    <tr className="border-b border-border-subtle last:border-0 align-top">
      {/* Tag: display code + mint date. */}
      <td className="px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-text-strong">{tag.code}</span>
          <span className="font-mono text-xs text-text-muted">{formatVnDate(tag.createdAt)}</span>
        </div>
      </td>
      {/* Lifecycle badge + a lost-mode danger badge (safety colour, never the flame — AA). */}
      <td className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={badge.tone}>{t(`status.${badge.labelKey}`)}</Badge>
          {tag.lostMode && (
            <Badge tone="danger" solid>
              {t('lost')}
            </Badge>
          )}
        </div>
      </td>
      {/* Chip UID + the pet-page URL burned to the chip (both mono). */}
      <td className="px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-xs text-text-body">{tag.chipUid ?? t('noChip')}</span>
          <span className="break-all font-mono text-xs text-accent-sky">{tag.url}</span>
        </div>
      </td>
      {/* Linked pet: emoji + name + @handle, or "chưa liên kết" for a tag with no pet yet. */}
      <td className="px-4 py-3">
        {tag.handle ? (
          <div className="flex items-center gap-2">
            <span aria-hidden className="text-lg">
              {speciesEmoji(tag.species)}
            </span>
            <div className="flex flex-col gap-0.5">
              <span className="font-display font-semibold text-text-strong">{tag.petName}</span>
              <span className="font-mono text-xs text-accent-sky">@{tag.handle}</span>
            </div>
          </div>
        ) : (
          <span className="text-text-muted">{t('notLinked')}</span>
        )}
      </td>
    </tr>
  );
}
