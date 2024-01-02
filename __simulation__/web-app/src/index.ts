import express from 'express'
import {createServer} from 'http'

const app = express()
app.get('/health', async (req, res) => {
  console.log('Received health check:1', new Date())
  // await new Promise((resolve, _reject) => {
  //   setTimeout(() => resolve(1), 6100)
  // })
  res.writeHead(200, {'Content-Type': 'text/html', 'Transfer-Encoding': 'chunked'})
  res.flushHeaders()
  res.write(JSON.stringify({message: 'Is healthy'}))
  // await new Promise((resolve, _reject) => {
  //   setTimeout(() => resolve(1), 3100)
  // })
  res.write(JSON.stringify({status: 200}))
  console.log('Received health check:2')
  res.end()
})

const httpServer = createServer(app)

httpServer.listen(80, async function () {
  console.log(`App listening at`, httpServer?.address?.())
})
