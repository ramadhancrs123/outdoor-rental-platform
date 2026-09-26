export const paths = {
  home: "/",
  dashboard: "/dashboard",
  katalog: "/katalog",
  penyewa: "/penyewa",
  blogPosts: "/blog-posts",
  categories: "/categories",
} as const;

export type AppPath = (typeof paths)[keyof typeof paths];
