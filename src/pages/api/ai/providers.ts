import type { NextApiRequest, NextApiResponse } from "next";
import { listConfiguredAiProviders } from "@/lib/ai-provider";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const providers = listConfiguredAiProviders();
  res.status(200).json({
    providers,
    count: providers.length,
  });
}
