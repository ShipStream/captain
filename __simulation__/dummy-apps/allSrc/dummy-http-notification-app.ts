import express from 'express'
import {createServer} from 'http'

const app = express()
app.use((req, res, next) => {
  console.log(
    'inspect',
    JSON.stringify({
      originalUrl: req.originalUrl,
      method: req.method,
      body: req.body,
      headers: req.headers,
      query: req.query,
    })
  )
  return next()
})

const HTTP_HEADER_KEY = 'notify_token'
const HTTP_HEADER_VALUE = 'dummy-sample-token-value'

app.post('/v1/api/post-custom-message', async (req, res) => {
  console.log('post-custom-message', {
    'req.headers?.[HTTP_HEADER_KEY]': req.headers?.[HTTP_HEADER_KEY],
    'HTTP_HEADER_VALUE': HTTP_HEADER_VALUE,
  })
  if (req.headers?.[HTTP_HEADER_KEY] !== HTTP_HEADER_VALUE) {
    return res.status(403).json({ success: false, error: `${HTTP_HEADER_KEY} don't match` })
  }
  return res.json({success: true})
})

const httpServer = createServer(app)

httpServer.listen(80, async function () {
  console.log(`App listening at`, httpServer?.address?.())
})
