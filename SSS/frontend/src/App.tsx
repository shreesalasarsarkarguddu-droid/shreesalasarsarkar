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

const guard = (el: ReactNode, perm?: Permission, admin?: boolean) => (
  <RequirePerm perm={perm} admin={admin}>
    {el}
  </RequirePerm>
);

/** Not moved to the new system yet: filled in by the next phases. */
const SOON: [string, string, Permission | undefined, boolean?][] = [
  ["/accounts/:sno/statement", "Account statement", "view_accounts"],
  ["/loans/:id/statement", "Loan statement", "view_accounts"],
  ["/loans/:id/edit", "Edit loan", "fix_entries"],
  ["/dashboard", "Dashboard", "reports"],
  ["/reports", "Reports", "reports"],
  ["/reports/day-book", "Day Book", "reports"],
  ["/reports/due-installments", "Due Installments", "reports"],
  ["/reports/finance-details", "Finance Details", "reports"],
  ["/reports/seized", "Seized Vehicles", "reports"],
  ["/my-collections", "My collection list", undefined],
  ["/approvals", "Approvals", "approve"],
  ["/cash", "Daily cash", undefined],
  ["/receipt-books", "Receipt books", "cash"],
  ["/zones", "Zones", undefined, true],
  ["/remarks", "Remarks", undefined],
  ["/assign", "Assign collections", "assign"],
  ["/activity", "Activity", "activity"],
  ["/users", "Users", undefined, true],
  ["/settings", "Settings", undefined, true],
  ["/settings/data", "Data", undefined, true],
];

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
        {SOON.map(([path, title, perm, admin]) => (
          <Route key={path} path={path} element={guard(<ComingSoon title={title} />, perm, admin)} />
        ))}
        <Route path="*" element={<ComingSoon title="Page not found" />} />
      </Route>
    </Routes>
  );
}
