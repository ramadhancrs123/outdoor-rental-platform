import type { ResourceProps } from "@refinedev/core";
import { paths } from "@/routes/paths";

export const resources: ResourceProps[] = [
  { name: "dashboard", list: paths.dashboard, meta: { label: "Dashboard" } },
  { name: "katalog", list: paths.katalog, meta: { label: "Katalog" } },
  { name: "penyewa", list: paths.penyewa, meta: { label: "Penyewa" } },
  {
    name: "blog_posts",
    list: paths.blogPosts,
    create: `${paths.blogPosts}/create`,
    edit: `${paths.blogPosts}/edit/:id`,
    show: `${paths.blogPosts}/show/:id`,
    meta: { canDelete: true, label: "Blog Posts" },
  },
  {
    name: "categories",
    list: paths.categories,
    create: `${paths.categories}/create`,
    edit: `${paths.categories}/edit/:id`,
    show: `${paths.categories}/show/:id`,
    meta: { canDelete: true, label: "Categories" },
  },
];
