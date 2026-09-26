import { NavigateToResource } from "@refinedev/react-router";
import { Outlet, Route, Routes } from "react-router";
import { ErrorComponent } from "@/components/refine-ui/layout/error-component";
import { Layout } from "@/components/refine-ui/layout/layout";
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
      <Route
        element={
          <Layout>
            <Outlet />
          </Layout>
        }
      >
        <Route
          index
          element={<NavigateToResource resource="blog_posts" />}
        />
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
