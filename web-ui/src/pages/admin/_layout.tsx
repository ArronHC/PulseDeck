import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import PulseAdminShell from "@/components/admin/PulseAdminShell";
import { AdminNavigationProvider } from "@/contexts/AdminNavigationContext";
import { AccountProvider, useAccount } from "@/contexts/AccountContext";
import Loading from "@/components/loading";
import { loginPath, resolveLoginRedirect } from "@/utils/loginRedirect";

const AdminLayout = () => {
  return (
    <AdminNavigationProvider>
      <PulseAdminShell content={<Outlet />} />
    </AdminNavigationProvider>
  );
};

const AdminRoute = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const account = useAccount();
  const [oauthRedirect, setOauthRedirect] = useState<string | null>(() => {
    const value = sessionStorage.getItem("oauth_redirect");
    sessionStorage.removeItem("oauth_redirect");
    return value ? resolveLoginRedirect(value) : null;
  });

  useEffect(() => {
    if (!account.loading && account.account?.logged_in && oauthRedirect) {
      const target = oauthRedirect;
      setOauthRedirect(null);
      navigate(target, { replace: true });
    }
  }, [account.account?.logged_in, account.loading, navigate, oauthRedirect]);

  if (account.loading) {
    return <Loading />;
  }
  if (!account.account?.logged_in) {
    return (
      <Navigate
        to={loginPath(location.pathname, location.search)}
        replace
      />
    );
  }
  if (oauthRedirect) {
    return <Loading />;
  }
  return <AdminLayout />;
};

export default function Admin() {
  return (
    <AccountProvider>
      <AdminRoute />
    </AccountProvider>
  );
}
