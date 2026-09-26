import { Authenticated } from "@refinedev/core";
import { Navigate, Outlet, Route, Routes } from "react-router";
import { ErrorComponent } from "@/components/refine-ui/layout/error-component";
import { Layout } from "@/components/refine-ui/layout/layout";
import { Login } from "@/pages/login";
import { Dashboard } from "@/pages/dashboard";
import { KatalogList, KatalogShow } from "@/pages/katalog";
import { RenterList, RenterShow } from "@/pages/penyewa";
import {
  BlogPostCreate,
  BlogPostEdit,
  BlogPostList,
  BlogPostShow,
} from "@/pages/blog-posts";
import {
  CategoryCreate,
  CategoryEdit,
  CategoryList,
  CategoryShow,
} from "@/pages/categories";
import { paths } from "./paths";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route
        element={
          <Authenticated key="admin-auth" fallback={<Navigate to="/login" replace />}>
            <Layout>
              <Outlet />
            </Layout>
          </Authenticated>
        }
      >
        <Route index element={<Navigate to={paths.dashboard} replace />} />
        <Route path={paths.dashboard} element={<Dashboard />} />

        <Route path={paths.katalog}>
          <Route index element={<KatalogList />} />
          <Route path="show/:id" element={<KatalogShow />} />
        </Route>

        <Route path={paths.penyewa}>
          <Route index element={<RenterList />} />
          <Route path=":id" element={<RenterShow />} />
        </Route>

        <Route path={paths.blogPosts}>
          <Route index element={<BlogPostList />} />
          <Route path="create" element={<BlogPostCreate />} />
          <Route path="edit/:id" element={<BlogPostEdit />} />
          <Route path="show/:id" element={<BlogPostShow />} />
        </Route>

        <Route path={paths.categories}>
          <Route index element={<CategoryList />} />
          <Route path="create" element={<CategoryCreate />} />
          <Route path="edit/:id" element={<CategoryEdit />} />
          <Route path="show/:id" element={<CategoryShow />} />
        </Route>

        <Route path="*" element={<ErrorComponent />} />
      </Route>
    </Routes>
  );
}
