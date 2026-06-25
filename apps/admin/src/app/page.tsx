import { Topbar } from '@/components/topbar';
import { StatCards } from '@/components/stat-cards';
import { RecentOrders } from '@/components/recent-orders';
import { TodoList } from '@/components/todo-list';

/** Admin dashboard (Tổng quan). Greeting + KPI cards + recent orders + the "Cần xử lý" action list. */
export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-8">
      <Topbar />
      <StatCards />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RecentOrders />
        </div>
        <TodoList />
      </div>
    </div>
  );
}
