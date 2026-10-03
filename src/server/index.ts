import { createGameServer } from "./app";
const server = createGameServer();
const port = Number(process.env.PORT ?? 3001),
  host = process.env.HOST ?? "0.0.0.0";
server.http.listen(port, host, () =>
  console.log(`Power Island listening on http://${host}:${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
