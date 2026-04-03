import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { optimizeSchedule } from "./src/utils/optimizer";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // API routes
  app.post("/api/optimize", (req, res) => {
    const { data, fixFirstRow, headers } = req.body;

    try {
      const result = optimizeSchedule(headers, data, fixFirstRow);
      res.json(result);
    } catch (error) {
      console.error("Optimization error:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Optimization failed" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
