/* Lets plain Node import the Durable Object files: "cloudflare:workers" only exists inside Cloudflare, so
   this module-loader hook hands back a bare DurableObject base class. Used by room-glue.test.mjs. */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") {
    return {
      url: "data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }",
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
