import { lazy, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router";
import { useAuth } from "@/lib/auth";
import { homeFor, type Permission } from "@/lib/permissions";
import { ComingSoon, RequirePerm } from "@/components/page-state";
import AppLayout from "@/app/layout";
import LoginPage from "@/app/login";

// pages load on demand (smaller first download on phones)
const AccountsPage = lazy(() => import("@/app/accounts/page"));
const AccountPage = lazy(() => import("@/app/accounts/page-sno"));
const LoanPage = lazy(() => import("@/app/loans/page-id"));
const NewLoanPage = lazy(() => import("@/app/loans/new/page"));
const PaymentsPage = lazy(() => import("@/app/payments/page"));
const CollectPage = lazy(() => import("@/app/payments/collect-page"));
const ProfilePage = lazy(() => import("@/app/profile/page"));
const StatementPage = lazy(() => import("@/app/statement-page"));
const DashboardPage = lazy(() => import("@/app/dashboard/page"));
const ReportsPage = lazy(() => import("@/app/reports/page"));
const DayBookPage = lazy(() => import("@/app/reports/day-book/page"));
const DueInstallmentsPage = lazy(() => import("@/app/reports/due-installments/page"));
const FinanceDetailsPage = lazy(() => import("@/app/reports/finance-details/page"));
const SeizedPage = lazy(() => import("@/app/reports/seized/page"));
const ApprovalsPage = lazy(() => import("@/app/approvals/page"));
const CashPage = lazy(() => import("@/app/cash/page"));
const ReceiptBooksPage = lazy(() => import("@/app/receipt-books/page"));
const ZonesPage = lazy(() => import("@/app/zones/page"));
const RemarksPage = lazy(() => import("@/app/remarks/page"));
const AssignPage = lazy(() => import("@/app/assign/page"));
const MyCollectionsPage = lazy(() => import("@/app/my-collections/page"));
const EditLoanPage = lazy(() => import("@/app/loans/edit/page"));
const ActivityPage = lazy(() => import("@/app/activity/page"));
const UsersPage = lazy(() => import("@/app/users/page"));
const SettingsPage = lazy(() => import("@/app/settings/page"));
const DataPage = lazy(() => import("@/app/settings/data/page"));

const guard = (el: ReactNode, perm?: Permission, admin?: boolean) => (
  <RequirePerm perm={perm} admin={admin}>
    {el}
  </RequirePerm>
);

/** Not moved to the new system yet: filled in by the next phases. */
const SOON: [string, string, Permission | undefined, boolean?][] = [];

function Home() {
  const { staff } = useAuth();
  return <Navigate to={homeFor(staff)} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AppLayout />}>
        <Route index element={<Home />} />
        <Route path="/accounts" element={guard(<AccountsPage />, "view_accounts")} />
        <Route path="/accounts/:sno" element={guard(<AccountPage />, "view_accounts")} />
        <Route path="/loans/new" element={guard(<NewLoanPage />, "new_loan")} />
        <Route path="/loans/:id" element={guard(<LoanPage />, "view_accounts")} />
        <Route path="/payments" element={guard(<PaymentsPage />, "collect")} />
        <Route path="/payments/:source/:ref" element={guard(<CollectPage />, "collect")} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/accounts/:sno/statement" element={guard(<StatementPage source="old" />, "view_accounts")} />
        <Route path="/loans/:id/statement" element={guard(<StatementPage source="new" />, "view_accounts")} />
        <Route path="/dashboard" element={guard(<DashboardPage />, "reports")} />
        <Route path="/reports" element={guard(<ReportsPage />, "reports")} />
        <Route path="/reports/day-book" element={guard(<DayBookPage />, "reports")} />
        <Route path="/reports/due-installments" element={guard(<DueInstallmentsPage />, "reports")} />
        <Route path="/reports/finance-details" element={guard(<FinanceDetailsPage />, "reports")} />
        <Route path="/reports/seized" element={guard(<SeizedPage />, "reports")} />
        <Route path="/approvals" element={guard(<ApprovalsPage />, "approve")} />
        <Route path="/cash" element={<RequirePerm any={["cash", "collect"]}><CashPage /></RequirePerm>} />
        <Route path="/receipt-books" element={guard(<ReceiptBooksPage />, "cash")} />
        <Route path="/zones" element={guard(<ZonesPage />, undefined, true)} />
        <Route path="/remarks" element={<RequirePerm any={["collect", "view_accounts"]}><RemarksPage /></RequirePerm>} />
        <Route path="/assign" element={guard(<AssignPage />, "assign")} />
        <Route path="/loans/:id/edit" element={guard(<EditLoanPage />, "fix_entries")} />
        <Route path="/activity" element={guard(<ActivityPage />, "activity")} />
        <Route path="/users" element={guard(<UsersPage />, undefined, true)} />
        <Route path="/settings" element={guard(<SettingsPage />, undefined, true)} />
        <Route path="/settings/data" element={guard(<DataPage />, undefined, true)} />
        <Route path="/my-collections" element={<RequirePerm any={["collect", "assign"]}><MyCollectionsPage /></RequirePerm>} />
        {SOON.map(([path, title, perm, admin]) => (
          <Route key={path} path={path} element={guard(<ComingSoon title={title} />, perm, admin)} />
        ))}
        <Route path="*" element={<ComingSoon title="Page not found" />} />
      </Route>
    </Routes>
  );
}
