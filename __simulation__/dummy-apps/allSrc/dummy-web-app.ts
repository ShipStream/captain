import express from 'express'
import {createServer} from 'http'

let ipsUP = process.env.IP_UP || []
ipsUP =`${ipsUP}`.replaceAll(/\s+/g, ',').split(',').filter((eachValue) => !!eachValue) as any
let ipsDELAYED = process.env.IP_DELAY || []
ipsDELAYED =`${ipsDELAYED}`.replaceAll(/\s+/g, ',').split(',').filter((eachValue) => !!eachValue) as any
let ipsDOWN = process.env.IP_DOWN || []
ipsDOWN =`${ipsDOWN}`.replaceAll(/\s+/g, ',').split(',').filter((eachValue) => !!eachValue) as any
console.log('assignedIps:3', {
  ipsUP,
  ipsDELAYED,
  ipsDOWN
})

enum IP_STATES {
  UP_STATE = 'UP_STATE',
  DELAYED_STATE = 'DELAYED_STATE',
  DOWN_STATE = 'DOWN_RESPONSE'
}

const ipStates: {[key:string]: IP_STATES} = {}
for (const eachIp of ipsUP) {
  ipStates[eachIp] = IP_STATES.UP_STATE
}
for (const eachIp of ipsDELAYED) {
  ipStates[eachIp] = IP_STATES.DELAYED_STATE
}
for (const eachIp of ipsDOWN) {
  ipStates[eachIp] = IP_STATES.DOWN_STATE
}

const app = express()
app.use((req, res, next) => {
  // console.log('inspect', JSON.stringify({
  //   'originalUrl': req.originalUrl,
  //   'method': req.method,
  //   'body': req.body,
  //   'headers': req.headers,
  //   'query': req.query,
  // }))
  return next()
})

app.post('/up', async (req, res) => {
  const hostFromHeader = req.headers['host']!
  ipStates[hostFromHeader] = IP_STATES.UP_STATE
  res.json({status: 'ok'})
})
app.post('/delay', async (req, res) => {
  const hostFromHeader = req.headers['host']!
  ipStates[hostFromHeader] = IP_STATES.DELAYED_STATE
  res.json({status: 'ok'})
})
app.post('/down', async (req, res) => {
  const hostFromHeader = req.headers['host']!
  ipStates[hostFromHeader] = IP_STATES.DOWN_STATE
  res.json({status: 'ok'})
})

app.get('/health', async (req, res) => {
  const hostFromHeader = req.headers['host']!
  switch(ipStates[hostFromHeader]) {
    case IP_STATES.UP_STATE:
      await new Promise((resolve, _reject) => {
        // small delay to simulate a natural response
        const delay = Math.floor(Math.random() * 1000) // maximum 1 sec as random will be between 0 and 1
        setTimeout(() => resolve(1), delay)
      })
      console.log('Received health check:case:UP_STATE', { hostFromHeader })      
      res.writeHead(200, {'Content-Type': 'text/html', 'Transfer-Encoding': 'chunked'})
      res.flushHeaders()
      res.write(JSON.stringify({message: 'Is healthy'}))
      res.write(JSON.stringify({status: 200}))
      res.end()
      break;
    case IP_STATES.DELAYED_STATE:
      console.log('Received health check:case:DELAYED_STATE', { hostFromHeader })
      await new Promise((resolve, _reject) => {
        setTimeout(() => resolve(1), 6100)
      })
      res.writeHead(200, {'Content-Type': 'text/html', 'Transfer-Encoding': 'chunked'})
      res.flushHeaders()
      res.write(JSON.stringify({message: 'Is healthy'}))
      await new Promise((resolve, _reject) => {
        setTimeout(() => resolve(1), 6100)
      })
      res.write(JSON.stringify({status: 200}))
      res.end()
      break;
    case IP_STATES.DOWN_STATE:
      console.log('Received health check:case:DOWN_STATE', { hostFromHeader })  
      res.writeHead(503, {'Content-Type': 'text/html', 'Transfer-Encoding': 'chunked'})
      res.flushHeaders()
      res.end()
      break;
    default:
      console.log('Received health check:case:UNKNOWN', { hostFromHeader })  
      res.writeHead(404, {'Content-Type': 'text/html', 'Transfer-Encoding': 'chunked'})
      res.flushHeaders()
      res.end()
      break;
  }
})

const httpServer = createServer(app)

httpServer.listen(80, async function () {
  console.log(`App listening at 5`, httpServer?.address?.())
})
