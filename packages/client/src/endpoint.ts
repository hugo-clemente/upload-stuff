export type RouteRegistry<T extends Record<string, unknown>> = {
  [K in keyof T]: K;
};

/** An endpoint, given as its name or a `(r) => r.name` selector (cmd+click-navigable). */
export type EndpointArg<
  TFileRouter extends Record<string, unknown>,
  TEndpoint extends keyof TFileRouter,
> = TEndpoint | ((r: RouteRegistry<TFileRouter>) => TEndpoint);

/**
 * Lets the caller pass a `(r) => r.routeName` selector so editors can cmd+click
 * the route name and navigate to its definition. Resolves the selector to the
 * route key via a Proxy.
 */
export const resolveEndpoint = <
  TFileRouter extends Record<string, unknown>,
  TEndpoint extends keyof TFileRouter,
>(
  endpoint: EndpointArg<TFileRouter, TEndpoint>,
): TEndpoint => {
  if (typeof endpoint === "function") {
    let resolved: string | undefined;
    const proxy = new Proxy(
      {},
      {
        get: (_target, prop) => {
          resolved = String(prop);
          return prop;
        },
      },
    ) as RouteRegistry<TFileRouter>;
    const key = endpoint(proxy);
    return (resolved ?? (key as string)) as TEndpoint;
  }
  return endpoint;
};
