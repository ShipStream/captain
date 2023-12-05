import express from "express";
import { createServer } from "http";

const app = express();
app.get('/health', async (req, res) => {
  console.log('Received health check', new Date())
  await new Promise((resolve, reject) => {
    setTimeout(() => resolve(1), 1900)
  })
  console.log('Received health check:2')
  res.status(200).json({message: "Is healthy", status: 200})
})

const httpServer = createServer(app);


httpServer.listen(80, async function () {
  console.log(`App listening at`, httpServer?.address?.())
});
