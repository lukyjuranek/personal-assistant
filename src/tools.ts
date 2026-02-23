
import { z } from "zod";
import { tool } from "@langchain/core/tools";



const searchTool = tool(
  async ({ query }: { query: string }) => {
    // In reality, you'd hit a real API here
    return `Search results for "${query}": lots of info found.`;
  },
  {
    name: "search",
    description: "Search the web for information",
    schema: z.object({ query: z.string().describe("Search query") }),
  }
);
