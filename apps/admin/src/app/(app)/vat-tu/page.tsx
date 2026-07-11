import { getTranslations } from 'next-intl/server';
import { fetchCostingBundle } from '@/lib/materials-fetch';
import { MaterialsView } from '@/components/materials-view';

/**
 * Vật tư & chi phí (ADR-039, design screen 8). An async server component: it fetches the four costing
 * reads (materials · machines · aux-costs · summary) from core-api forwarding the session cookie
 * (no-store → always live) and hands the bundle to the interactive tab view. Loading is ./loading.tsx;
 * a fetch failure is caught by (app)/error.tsx (retry). This slice is read-only — the write dialogs
 * (nhập cuộn / thêm máy / …) are a later slice, so the header carries no action buttons yet.
 */
export default async function MaterialsPage() {
  const t = await getTranslations('materials');
  const bundle = await fetchCostingBundle();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-2xl font-semibold text-text-strong">{t('title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-muted">{t('subtitle')}</p>
      </header>

      <MaterialsView bundle={bundle} />
    </div>
  );
}
