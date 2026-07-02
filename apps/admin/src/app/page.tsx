import { Topbar } from '@/components/topbar';
import { StatCards } from '@/components/stat-cards';
import { RecentOrders } from '@/components/recent-orders';
import { TodoList } from '@/components/todo-list';
import { fetchDashboard } from '@/lib/dashboard-fetch';
import { toStatCards, toRecentOrders, toTodos } from '@/lib/dashboard';

/**
 * Admin dashboard (Tổng quan). Greeting + KPI cards + recent orders + the "Cần xử lý" action list.
 * An async server component: it fetches the live snapshot from core-api (reading cookies makes the
 * route dynamic, so it is never statically prerendered), maps it with the pure adapters, and passes
 * plain props down. Loading is app/loading.tsx (Suspense skeleton); a fetch failure is caught by
 * app/error.tsx (retry); empty renders as 0 / an empty table (spec §03).
 */
export default async function DashboardPage() {
  const snapshot = await fetchDashboard();

  return (
    <div className="flex flex-col gap-8">
      <Topbar />
      <StatCards stats={toStatCards(snapshot.stats)} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RecentOrders orders={toRecentOrders(snapshot.recentOrders)} />
        </div>
        <TodoList todos={toTodos(snapshot)} />
      </div>
    </div>
  );
}
