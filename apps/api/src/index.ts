import "dotenv/config";
import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import { authRouter } from "./routes/auth";
import { ordersRouter } from "./routes/orders";
import { sitesRouter } from "./routes/sites";
import { complaintsRouter } from "./routes/complaints";
import { pendingActionsRouter } from "./routes/pendingActions";
import { dashboardRouter } from "./routes/dashboard";
import { usersRouter } from "./routes/users";
import { lookupsRouter } from "./routes/lookups";
import { settingsRouter } from "./routes/settings";
import { customersRouter } from "./routes/customers";
import { productsRouter } from "./routes/products";
import { vendorsRouter } from "./routes/vendors";
import { quotationsRouter } from "./routes/quotations";
import { invoicesRouter } from "./routes/invoices";
import { purchaseOrdersRouter } from "./routes/purchase-orders";
import { expensesRouter } from "./routes/expenses";
import { financeDashboardRouter } from "./routes/financeDashboard";
import { portalRouter } from "./routes/portal";
import { workOrdersRouter } from "./routes/workOrders";

const app = express();
app.use(cors());
// Raise the body limit so base64 data-URL payloads (site photos, company logo) fit;
// the default 100kb rejects anything but a thumbnail.
app.use(express.json({ limit: "10mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/auth", authRouter);
app.use("/orders", ordersRouter);
app.use("/customers", customersRouter);
app.use("/products", productsRouter);
app.use("/vendors", vendorsRouter);
app.use("/sites", sitesRouter);
app.use("/complaints", complaintsRouter);
app.use("/pending-actions", pendingActionsRouter);
app.use("/dashboard", dashboardRouter);
app.use("/users", usersRouter);
app.use("/settings", settingsRouter);
app.use("/meta", lookupsRouter);
app.use("/quotations", quotationsRouter);
app.use("/invoices", invoicesRouter);
app.use("/purchase-orders", purchaseOrdersRouter);
app.use("/expenses", expensesRouter);
app.use("/finance", financeDashboardRouter);
app.use("/portal", portalRouter);
app.use("/work-orders", workOrdersRouter);

// Catches anything a route handler throws or rejects with (Express 5 forwards rejected
// async handlers here automatically) so a downstream failure - like the database being
// unreachable - returns a clean error response instead of crashing the process.
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
};
app.use(errorHandler);

const port = Number(process.env.PORT) || 4000;
if (process.env.NODE_ENV !== "production" || !process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`API listening on http://localhost:${port}`);
  });
}

export default app;
