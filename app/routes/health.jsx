/**
 * Health Check Endpoint
 * Public endpoint for monitoring and load balancer probes.
 * GET /health -> { status: "ok", timestamp: "..." }
 */

export const loader = async () => {
  return new Response(
    JSON.stringify({
      status: "ok",
      timestamp: new Date().toISOString(),
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    }
  );
};
