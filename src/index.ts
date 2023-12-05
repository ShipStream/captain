import express from "express";
import { createServer } from "http";
import { Server as SocketServer } from "socket.io";
import appConfig from './appConfig.js'
import { setupSocketConnectionAndListeners } from "./socket/captainSocketServerManager.js";
import { connectWithOtherCaptains } from "./socket/captainSocketClientManager.js";
import { processWebServiceFileYAML } from "./web-service/webServiceHelper.js";
import { initializeDnsManager } from "./dns/dnsManager.js";
import { checkAndPromoteToLeader } from "./coreUtils.js";

const io = new SocketServer(appConfig.CAPTAIN_PORT, { /* options */ });
setupSocketConnectionAndListeners(io)

const app = express();
const httpServer = createServer(app);
httpServer.listen(80, async function () {
  console.log(`App listening at`, httpServer?.address?.())
  // console.log('appConfig', {
  //   appConfig,
  // })
  try {
    checkAndPromoteToLeader()
    initializeDnsManager()
    await processWebServiceFileYAML()
    await connectWithOtherCaptains(appConfig.MEMBER_URLS.filter((eachMember: string) => eachMember !== appConfig.SELF_URL))
  } catch (err) {
    console.log('Initialization failed, exiting...')
    console.error(err)
    shutdown()
  }
});

/* 
  Reload YAML on SIGHUP
  TODO
  a). check and remove state of services that is absent in the new file
  b). process any changes to existing file ?
*/
process.on('SIGHUP', function () {
  console.log('received SIGHUP')
  processWebServiceFileYAML().catch((err) => {
    console.log('Reinitialization with processServiceFileYAML failed, exiting...')
    console.error(err)
    shutdown()
  })
})

const shutdown = () => {
  console.log('Starting shutdown...')
  httpServer.close()
  console.log('Goodbye!')
  process.exit()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.on('uncaughtException', (error, origin) => {
  console.error(origin, error)
  process.exit(1)
})
