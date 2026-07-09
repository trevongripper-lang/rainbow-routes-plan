import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { defaultAuthState } from "./lib/auth-state";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient, auth: defaultAuthState },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
