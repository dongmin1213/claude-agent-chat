import { NextRequest } from "next/server";

export const runtime = "nodejs";

// Mid-stream injection is disabled — SDK's interrupt() causes ede_diagnostic
// crashes. Messages are queued on the frontend and sent after the current
// stream completes instead.
export async function POST(request: NextRequest) {
  return new Response(
    JSON.stringify({ error: "Mid-stream injection is disabled. Messages are queued automatically." }),
    { status: 410, headers: { "Content-Type": "application/json" } }
  );
}
