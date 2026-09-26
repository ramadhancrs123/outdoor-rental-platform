import type { ResourceProps } from "@refinedev/core";
import { paths } from "@/routes/paths";

export const resources: ResourceProps[] = [
  {
    name: "blog_posts",
    list: paths.blogPosts,
    create: `${paths.blogPosts}/create`,
    edit: `${paths.blogPosts}/edit/:id`,
    show: `${paths.blogPosts}/show/:id`,
    meta: {
      canDelete: true,
    },
  },
  {
    name: "categories",
    list: paths.categories,
    create: `${paths.categories}/create`,
    edit: `${paths.categories}/edit/:id`,
    show: `${paths.categories}/show/:id`,
    meta: {
      canDelete: true,
    },
  },
];
