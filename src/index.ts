import express from 'express'
import {createServer} from 'http'
import {Server as SocketServer} from 'socket.io'
import appConfig from './appConfig.js'

import {setupSocketConnectionAndListeners} from './socket/captainSocketServerManager.js'
import {connectWithOtherCaptains} from './socket/captainSocketClientManager.js'
import {processWebServiceFileYAML} from './web-service/webServiceHelper.js'
import {initializeDnsManager} from './dns/dnsManager.js'
import {checkAndPromoteToLeader} from './coreUtils.js'
import {setupExpress} from './restApi.js'

/* 
  Reload YAML on SIGHUP
  TODO
  a). check and remove state of services that is absent in the new file
  b). process any changes to existing file ?
*/
process.on('SIGHUP', function () {
  console.info('received SIGHUP')
  processWebServiceFileYAML().catch((err) => {
    console.info('Reinitialization with processServiceFileYAML failed, exiting...')
    console.error(err)
    shutdown()
  })
})

const shutdown = () => {
  console.info('Starting shutdown...')
  httpServer.close()
  console.info('Goodbye!')
  process.exit()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.on('unhandledRejection', (error, origin) => {
  console.error(origin, error)
  process.exit(1)
})
process.on('uncaughtException', (error, origin) => {
  console.error(origin, error)
  process.exit(1)
})

const io = new SocketServer(appConfig.CAPTAIN_PORT, {
  /* options */
})
setupSocketConnectionAndListeners(io)

const app = express()
setupExpress(app)
const httpServer = createServer(app)
httpServer.listen(80, async function () {
  console.info(`App listening at: 1`, httpServer?.address?.())
  // logger.info('appConfig', {
  //   appConfig,
  // })
  try {
    checkAndPromoteToLeader()
    await initializeDnsManager() // Depends on 'checkAndPromoteToLeader'
    await processWebServiceFileYAML()
    await connectWithOtherCaptains(
      appConfig.MEMBER_URLS.filter((eachMember: string) => eachMember !== appConfig.SELF_URL)
    )
  } catch (err) {
    console.info('Initialization failed, exiting...')
    console.error(err)
    shutdown()
  }
})