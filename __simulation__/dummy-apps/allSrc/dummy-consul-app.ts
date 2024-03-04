import express from 'express'
import {createServer} from 'http'

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

const NUMBER_OF_NODES = process.env.NUMBER_OF_NODES ? Number(process.env.NUMBER_OF_NODES) : 3

// response mocks data for only fields that is used in the captain app
// doesn't mock the whole consul response
const consulDummyResponses: {
  Stats: {
    Config: {
      Datacenter: string
      PrimaryDatacenter: string
      NodeName: string
      Server: boolean
    }
    consul: {
      leader: string
    }
  }
}[] = []

function setupNode(nodeIndex: number) {
  const routerPrefix = `/consul-${nodeIndex + 1}`
  consulDummyResponses.push({
    Stats: {
      Config: {
        Datacenter: 'dc1',
        PrimaryDatacenter: 'dc1',
        NodeName: `consul-${nodeIndex + 1}`,
        Server: true,
      },
      consul: {
        leader: 'false',
      },
    },
  })
  const eachConsulRouter = express.Router()
  eachConsulRouter.get('/v1/agent/self', (req, res) => {
    console.log(`${routerPrefix}/v1/agent/self: called`)
    res.json(consulDummyResponses[nodeIndex])
  })
  eachConsulRouter.post('/make-leader', (req, res) => {
    console.log(`${routerPrefix}/make-leader: called`)
    // make everything follower to prevent dual leadship
    makeAllFollowers()
    // then make this a leader
    consulDummyResponses[nodeIndex]!.Stats.consul.leader = 'true'
    res.json({success: true, data: consulDummyResponses[nodeIndex]})
  })
  console.log({ routerPrefix })
  app.use(`${routerPrefix}`, eachConsulRouter)
}

for (let nodeIndex = 0; nodeIndex < NUMBER_OF_NODES; nodeIndex++) {
  setupNode(nodeIndex)
}

/**
 * Mark all mock response to return 'false' for 'leader'
 *
 */
function makeAllFollowers() {
  for (const eachMock of consulDummyResponses) {
    eachMock.Stats.consul.leader = 'false'
  }
}

/**
 * Mark one random mock-response among to return 'true' for leader
 *
 */
function electRandomLeader() {
  makeAllFollowers()
  const randomLeader = Math.floor(Math.random() * consulDummyResponses.length)
  consulDummyResponses[randomLeader]!.Stats.consul.leader = 'true'
}

// Elect a random leader on boot
// electRandomLeader()
consulDummyResponses[2]!.Stats.consul.leader = 'true'

app.post('/make-all-followers', (req, res) => {
  console.log('make-all-followers: called')
  makeAllFollowers()
  res.json({success: true})
})

app.post('/elect-random-leader', (req, res) => {
  console.log('elect-random-leader: called')
  electRandomLeader()
  res.json({success: true})
})

app.get('/', (req, res) => {
  res.json({success: true})
})

const httpServer = createServer(app)
httpServer.listen(80, async function () {
  console.log(`App listening at`, httpServer?.address?.())
})
