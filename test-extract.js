import { runScrapeJob } from "./src/lib/extraction-pipeline.js";

async function test() {
  console.log("Starting test extraction...");
  try {
    const result = await runScrapeJob({ 
      url: "https://donutshop.framer.website/",
      removeWatermarks: true 
    }, (e) => {
      console.log("Event:", e.type, e.message || "");
    });
    console.log("Extraction complete:", result.id);
  } catch (err) {
    console.error("Extraction failed:", err);
  }
}

test();
