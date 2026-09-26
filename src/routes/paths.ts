export const paths = {
  home: "/",
  blogPosts: "/blog-posts",
  categories: "/categories",
} as const;

export type AppPath = (typeof paths)[keyof typeof paths];
